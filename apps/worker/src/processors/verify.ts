import { Job } from "bullmq";
import { and, eq } from "drizzle-orm";

import {
  auditRuns,
  type JobPayloadMap,
  verificationSteps
} from "@ton-audit/shared";

import { db } from "../db";
import { recordJobEvent } from "../job-events";
import { workerLogger } from "../logger";
import { loadRevisionFilesWithContent } from "../revision-files";
import { putObject } from "../s3";
import { planSandboxVerification } from "../sandbox/adapters";
import { executeSandboxPlan, summarizeSandboxResults } from "../sandbox/client";
import type { EnqueueJob } from "./types";

type Diagnostic = {
  filePath: string;
  line: number;
  message: string;
  level: "error" | "warning" | "info";
};

type SecurityScanAction = "security-rules-scan" | "security-surface-scan";

type SecurityScanDiagnostic = {
  ruleId: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "informational";
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
  remediation: string;
  confidence: number;
};

type SecurityScanArtifact = {
  scanner: SecurityScanAction;
  status: "completed" | "failed" | "skipped" | "timeout";
  diagnostics: SecurityScanDiagnostic[];
  rawSummary: string;
  parsed: boolean;
};

type VerifyProgressStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "timeout";

type VerifyProgressStepPayload = {
  id: string;
  action: string;
  status: VerifyProgressStepStatus;
  optional: boolean;
  timeoutMs: number;
  durationMs?: number;
};

const securityScanActions = new Set<SecurityScanAction>([
  "security-rules-scan",
  "security-surface-scan"
]);

function collectDeterministicDiagnostics(files: Awaited<ReturnType<typeof loadRevisionFilesWithContent>>) {
  const diagnostics: Diagnostic[] = [];

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      const lower = line.toLowerCase();

      if (lower.includes("todo") || lower.includes("fixme")) {
        diagnostics.push({
          filePath: file.path,
          line: index + 1,
          message: "TODO/FIXME marker left in source.",
          level: "info"
        });
      }

      if (lower.includes("send_raw_message") || lower.includes("accept_message")) {
        diagnostics.push({
          filePath: file.path,
          line: index + 1,
          message: "Review raw message handling and gas assumptions.",
          level: "warning"
        });
      }

      if (lower.includes("throw(") || lower.includes("throwif")) {
        diagnostics.push({
          filePath: file.path,
          line: index + 1,
          message: "Throw path detected; confirm explicit error semantics.",
          level: "warning"
        });
      }
    });
  }

  return diagnostics;
}

function detectToolchain(files: Awaited<ReturnType<typeof loadRevisionFilesWithContent>>) {
  const filePaths = new Set(files.map((file) => file.path.toLowerCase()));
  if (filePaths.has("blueprint.config.ts") || filePaths.has("blueprint.config.js")) {
    return "blueprint";
  }
  if ([...filePaths].some((item) => item.endsWith(".tact"))) {
    return "tact";
  }
  if ([...filePaths].some((item) => item.endsWith(".fc") || item.endsWith(".func"))) {
    return "func";
  }
  if ([...filePaths].some((item) => item.endsWith(".tolk"))) {
    return "tolk";
  }
  return "static";
}

function normalizeSecuritySeverity(value: unknown): SecurityScanDiagnostic["severity"] {
  if (
    value === "critical" ||
    value === "high" ||
    value === "medium" ||
    value === "low" ||
    value === "informational"
  ) {
    return value;
  }

  return "informational";
}

function parseSecurityScanDiagnostics(action: SecurityScanAction, stdout: string): SecurityScanArtifact {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid scan JSON payload");
    }

    const payload = parsed as {
      summary?: unknown;
      diagnostics?: unknown;
    };
    const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
    const normalizedDiagnostics = diagnostics
      .map((entry): SecurityScanDiagnostic | null => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        const row = entry as Record<string, unknown>;
        const ruleId = typeof row.ruleId === "string" && row.ruleId.trim() ? row.ruleId.trim() : "UNSPECIFIED";
        const title =
          typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Security scan diagnostic";
        const filePath =
          typeof row.filePath === "string" && row.filePath.trim() ? row.filePath.trim() : "unknown";
        const startLine =
          typeof row.startLine === "number" && Number.isFinite(row.startLine)
            ? Math.max(1, Math.trunc(row.startLine))
            : 1;
        const endLine =
          typeof row.endLine === "number" && Number.isFinite(row.endLine)
            ? Math.max(startLine, Math.trunc(row.endLine))
            : startLine;
        const snippet =
          typeof row.snippet === "string" && row.snippet.trim() ? row.snippet.trim() : "No snippet provided";
        const remediation =
          typeof row.remediation === "string" && row.remediation.trim()
            ? row.remediation.trim()
            : "Review and harden the flagged pattern.";
        const confidence =
          typeof row.confidence === "number" && Number.isFinite(row.confidence)
            ? Math.min(1, Math.max(0, row.confidence))
            : 0.6;

        return {
          ruleId,
          title,
          severity: normalizeSecuritySeverity(row.severity),
          filePath,
          startLine,
          endLine,
          snippet,
          remediation,
          confidence
        };
      })
      .filter((item): item is SecurityScanDiagnostic => Boolean(item));

    const rawSummary =
      typeof payload.summary === "string" && payload.summary.trim()
        ? payload.summary.trim()
        : `${normalizedDiagnostics.length} diagnostics`;

    return {
      scanner: action,
      status: "completed",
      diagnostics: normalizedDiagnostics,
      rawSummary,
      parsed: true
    };
  } catch {
    return {
      scanner: action,
      status: "failed",
      diagnostics: [],
      rawSummary: "Unable to parse security scan JSON output.",
      parsed: false
    };
  }
}

export function createVerifyProcessor(deps: { enqueueJob: EnqueueJob }) {
  return async function verify(job: Job<JobPayloadMap["verify"]>) {
    const context = {
      queue: "verify",
      jobId: String(job.id),
      projectId: job.data.projectId,
      revisionId: job.data.revisionId,
      auditRunId: job.data.auditRunId,
      profile: job.data.profile
    };

    workerLogger.info("verify.stage.started", context);

    await recordJobEvent({
      projectId: job.data.projectId,
      queue: "verify",
      jobId: String(job.id),
      event: "started",
      payload: { data: job.data }
    });

    const auditRun = await db.query.auditRuns.findFirst({
      where: and(eq(auditRuns.id, job.data.auditRunId), eq(auditRuns.projectId, job.data.projectId))
    });

    if (!auditRun) {
      throw new Error("Audit run not found");
    }

    workerLogger.info("verify.stage.audit-run-found", {
      ...context,
      runStatus: auditRun.status
    });

    await db
      .update(auditRuns)
      .set({
        status: "running",
        startedAt: auditRun.startedAt ?? new Date(),
        updatedAt: new Date()
      })
      .where(eq(auditRuns.id, auditRun.id));

    workerLogger.info("verify.stage.audit-run-marked-running", context);
    const verifyStartedAt = Date.now();

    try {
      const files = await loadRevisionFilesWithContent(job.data.revisionId);
      const toolchain = detectToolchain(files);
      const diagnostics = collectDeterministicDiagnostics(files);
      const plan = planSandboxVerification(
        files.map((file) => ({
          path: file.path,
          content: file.content
        })),
        job.data.profile
      );
      const plannedSecurityScans = plan.steps.filter((step) =>
        securityScanActions.has(step.action as SecurityScanAction)
      );
      const plannedProgressSteps: VerifyProgressStepPayload[] = plan.steps.map((step) => ({
        id: step.id,
        action: step.action,
        status: "pending",
        optional: Boolean(step.optional),
        timeoutMs: step.timeoutMs
      }));

      workerLogger.info("verify.stage.inputs-loaded", {
        ...context,
        fileCount: files.length,
        toolchain,
        sandboxAdapter: plan.adapter,
        sandboxStepCount: plan.steps.length,
        diagnosticsCount: diagnostics.length,
        plannedSecurityScans: plannedSecurityScans.length
      });

      await recordJobEvent({
        projectId: job.data.projectId,
        queue: "verify",
        jobId: String(job.id),
        event: "progress",
        payload: {
          auditRunId: auditRun.id,
          phase: "plan-ready",
          toolchain,
          sandboxAdapter: plan.adapter,
          profile: job.data.profile,
          totalSteps: plannedProgressSteps.length,
          securityScans: plannedSecurityScans.map((step) => step.action),
          steps: plannedProgressSteps
        }
      });

      let sandboxExecutionSummary = "Sandbox execution skipped";
      let sandboxResults: Awaited<ReturnType<typeof executeSandboxPlan>>["results"] = [];
      let securityScanArtifacts: SecurityScanArtifact[] = [];
      let securityScanDiagnostics: SecurityScanDiagnostic[] = [];
      let sandboxExecutionFailed = false;

      if (plan.steps.length > 0) {
        const liveProgressSteps = plannedProgressSteps.map((step) => ({
          ...step
        }));
        const snapshotLiveProgressSteps = () =>
          liveProgressSteps.map((step) => ({
            ...step
          }));
        const upsertLiveProgressStep = (step: VerifyProgressStepPayload) => {
          const existingIndex = liveProgressSteps.findIndex((item) => item.id === step.id);
          const mergedStep =
            existingIndex >= 0
              ? {
                  ...liveProgressSteps[existingIndex],
                  ...step
                }
              : step;

          if (existingIndex >= 0) {
            liveProgressSteps[existingIndex] = mergedStep;
          } else {
            liveProgressSteps.push(mergedStep);
          }

          return mergedStep;
        };

        if (plannedSecurityScans.length > 0) {
          await recordJobEvent({
            projectId: job.data.projectId,
            queue: "verify",
            jobId: String(job.id),
            event: "progress",
            payload: {
              auditRunId: auditRun.id,
              phase: "security-scan",
              status: "started",
              profile: job.data.profile,
              scans: plannedSecurityScans.map((step) => ({
                id: step.id,
                action: step.action,
                optional: Boolean(step.optional)
              }))
            }
          });
        }

        workerLogger.info("verify.stage.sandbox-starting", {
          ...context,
          sandboxStepCount: plan.steps.length
        });
        await recordJobEvent({
          projectId: job.data.projectId,
          queue: "verify",
          jobId: String(job.id),
          event: "progress",
          payload: {
            auditRunId: auditRun.id,
            phase: "sandbox-running",
            toolchain,
            sandboxAdapter: plan.adapter,
            totalSteps: liveProgressSteps.length,
            currentStepId: null,
            steps: snapshotLiveProgressSteps()
          }
        });

        try {
          const execution = await executeSandboxPlan({
            files: files.map((file) => ({ path: file.path, content: file.content })),
            plan,
            projectId: job.data.projectId,
            revisionId: job.data.revisionId,
            onProgress: async (event) => {
              if (event.type === "started") {
                if (event.steps.length) {
                  for (const step of event.steps) {
                    const existingStep = liveProgressSteps.find((item) => item.id === step.id);
                    if (existingStep && existingStep.status !== "pending") {
                      continue;
                    }
                    upsertLiveProgressStep({
                      id: step.id,
                      action: step.action,
                      status: "pending",
                      optional: Boolean(step.optional),
                      timeoutMs: step.timeoutMs
                    });
                  }
                }

                await recordJobEvent({
                  projectId: job.data.projectId,
                  queue: "verify",
                  jobId: String(job.id),
                  event: "progress",
                  payload: {
                    auditRunId: auditRun.id,
                    phase: "sandbox-running",
                    toolchain,
                    sandboxAdapter: plan.adapter,
                    mode: event.mode,
                    totalSteps: event.totalSteps,
                    currentStepId: null,
                    steps: snapshotLiveProgressSteps()
                  }
                });
                return;
              }

              if (event.type === "step-started" || event.type === "step-finished") {
                const nextStep: VerifyProgressStepPayload = {
                  id: event.step.id,
                  action: event.step.action,
                  status: event.step.status,
                  optional: Boolean(event.step.optional),
                  timeoutMs: event.step.timeoutMs
                };
                if (typeof event.step.durationMs === "number") {
                  nextStep.durationMs = event.step.durationMs;
                }
                const liveStep = upsertLiveProgressStep(nextStep);

                await recordJobEvent({
                  projectId: job.data.projectId,
                  queue: "verify",
                  jobId: String(job.id),
                  event: "sandbox-step",
                  payload: {
                    auditRunId: auditRun.id,
                    step: liveStep,
                    index: event.index,
                    totalSteps: event.totalSteps
                  }
                });
                return;
              }
            }
          });

          sandboxResults = execution.results;
          const unsupportedActions = execution.unsupportedActions ?? [];
          const summary = summarizeSandboxResults(execution.results);
          if (unsupportedActions.length > 0) {
            workerLogger.warn("verify.stage.sandbox-unsupported-actions", {
              ...context,
              unsupportedActions
            });
          }
          for (const stepResult of execution.results) {
            const knownStep = liveProgressSteps.find((item) => item.id === stepResult.id);
            upsertLiveProgressStep({
              id: stepResult.id,
              action: stepResult.action,
              status: stepResult.status,
              optional: knownStep?.optional ?? false,
              timeoutMs: knownStep?.timeoutMs ?? 0,
              durationMs: stepResult.durationMs
            });
          }
          for (const step of liveProgressSteps) {
            if (step.status === "pending") {
              upsertLiveProgressStep({
                ...step,
                status: "skipped"
              });
            }
          }
          const finalizedProgressSteps = snapshotLiveProgressSteps();
          const sandboxExecutionSummaryParts = [
            `Sandbox mode: ${execution.mode}`,
            `Adapter: ${plan.adapter}`,
            `Completed: ${summary.completed}`,
            `Failed: ${summary.failed}`,
            `Skipped: ${summary.skipped}`,
            `Timeout: ${summary.timeout}`
          ];
          if (unsupportedActions.length > 0) {
            sandboxExecutionSummaryParts.push(
              `Unsupported actions skipped: ${unsupportedActions.join(", ")}`
            );
          }
          sandboxExecutionSummary = sandboxExecutionSummaryParts.join(" | ");

          workerLogger.info("verify.stage.sandbox-completed", {
            ...context,
            mode: execution.mode,
            sandboxCompleted: summary.completed,
            sandboxFailed: summary.failed,
            sandboxSkipped: summary.skipped,
            sandboxTimeout: summary.timeout,
            unsupportedActions
          });
          await recordJobEvent({
            projectId: job.data.projectId,
            queue: "verify",
            jobId: String(job.id),
            event: "progress",
            payload: {
              auditRunId: auditRun.id,
              phase: "sandbox-completed",
              toolchain,
              sandboxAdapter: plan.adapter,
              mode: execution.mode,
              totalSteps: finalizedProgressSteps.length,
              completed: summary.completed,
              failed: summary.failed,
              skipped: summary.skipped,
              timeout: summary.timeout,
              unsupportedActions,
              steps: finalizedProgressSteps
            }
          });
        } catch (sandboxError) {
          sandboxExecutionFailed = true;
          sandboxExecutionSummary = `Sandbox execution unavailable: ${
            sandboxError instanceof Error ? sandboxError.message : "Unknown error"
          }`;

          workerLogger.warn("verify.stage.sandbox-failed", {
            ...context,
            error: sandboxError
          });
          await recordJobEvent({
            projectId: job.data.projectId,
            queue: "verify",
            jobId: String(job.id),
            event: "progress",
            payload: {
              auditRunId: auditRun.id,
              phase: "sandbox-failed",
              toolchain,
              sandboxAdapter: plan.adapter,
              totalSteps: liveProgressSteps.length,
              message: sandboxError instanceof Error ? sandboxError.message : "Unknown sandbox error",
              steps: snapshotLiveProgressSteps()
            }
          });
        }
      } else {
        await recordJobEvent({
          projectId: job.data.projectId,
          queue: "verify",
          jobId: String(job.id),
          event: "progress",
          payload: {
            auditRunId: auditRun.id,
            phase: "sandbox-skipped",
            toolchain,
            sandboxAdapter: plan.adapter,
            totalSteps: 0,
            steps: []
          }
        });
      }

      const executedSecurityScanResults = sandboxResults.filter((result) =>
        securityScanActions.has(result.action as SecurityScanAction)
      );
      securityScanArtifacts = executedSecurityScanResults.map((result) => {
        if (!securityScanActions.has(result.action as SecurityScanAction)) {
          return {
            scanner: "security-rules-scan",
            status: "failed",
            diagnostics: [],
            rawSummary: "Unexpected scanner action.",
            parsed: false
          } satisfies SecurityScanArtifact;
        }

        const scanArtifact = parseSecurityScanDiagnostics(
          result.action as SecurityScanAction,
          result.stdout || "{}"
        );

        return {
          ...scanArtifact,
          status: result.status
        };
      });
      securityScanDiagnostics = securityScanArtifacts.flatMap((artifact) => artifact.diagnostics);
      const missingSecurityScans = Math.max(plannedSecurityScans.length - securityScanArtifacts.length, 0);
      const failedSecurityScans =
        securityScanArtifacts.filter(
          (artifact) => artifact.status === "failed" || artifact.status === "timeout"
        ).length + missingSecurityScans;

      if (plannedSecurityScans.length > 0) {
        const completedScans = securityScanArtifacts.filter((artifact) => artifact.status === "completed").length;

        await recordJobEvent({
          projectId: job.data.projectId,
          queue: "verify",
          jobId: String(job.id),
          event: "progress",
          payload: {
            auditRunId: auditRun.id,
            phase: "security-scan",
            status: failedSecurityScans > 0 ? "completed_with_failures" : "completed",
            completedScans,
            failedScans: failedSecurityScans,
            diagnostics: securityScanDiagnostics.length
          }
        });
      }

      const stdout = [
        `Verification toolchain: ${toolchain}`,
        `Files scanned: ${files.length}`,
        `Diagnostics generated: ${diagnostics.length}`,
        `Security diagnostics generated: ${securityScanDiagnostics.length}`,
        `Sandbox: ${sandboxExecutionSummary}`
      ].join("\n");

      const stderr = diagnostics
        .filter((item) => item.level === "error")
        .map((item) => `${item.filePath}:${item.line} ${item.message}`)
        .join("\n");

      const stdoutKey = `verification/${auditRun.id}/stdout.txt`;
      const stderrKey = `verification/${auditRun.id}/stderr.txt`;
      const diagnosticsKey = `verification/${auditRun.id}/diagnostics.json`;
      const sandboxKey = `verification/${auditRun.id}/sandbox-results.json`;
      const securityScanKey = `verification/${auditRun.id}/security-scans.json`;
      const securityScanSummaryKey = `verification/${auditRun.id}/security-scan-summary.json`;

      await Promise.all([
        putObject({
          key: stdoutKey,
          body: stdout,
          contentType: "text/plain; charset=utf-8"
        }),
        putObject({
          key: stderrKey,
          body: stderr || "No stderr output",
          contentType: "text/plain; charset=utf-8"
        }),
        putObject({
          key: diagnosticsKey,
          body: JSON.stringify(diagnostics, null, 2),
          contentType: "application/json"
        }),
        putObject({
          key: sandboxKey,
          body: JSON.stringify(sandboxResults, null, 2),
          contentType: "application/json"
        }),
        putObject({
          key: securityScanKey,
          body: JSON.stringify(securityScanArtifacts, null, 2),
          contentType: "application/json"
        }),
        putObject({
          key: securityScanSummaryKey,
          body: JSON.stringify(
            {
              profile: job.data.profile,
              plannedScans: plannedSecurityScans.map((step) => step.action),
              scanCount: securityScanArtifacts.length,
              diagnostics: securityScanDiagnostics.length,
              bySeverity: securityScanDiagnostics.reduce<Record<string, number>>((acc, diagnostic) => {
                acc[diagnostic.severity] = (acc[diagnostic.severity] ?? 0) + 1;
                return acc;
              }, {})
            },
            null,
            2
          ),
          contentType: "application/json"
        })
      ]);

      workerLogger.info("verify.stage.artifacts-persisted", {
        ...context,
        diagnosticsKey,
        sandboxKey,
        securityScanKey
      });

      await db.insert(verificationSteps).values({
        auditRunId: auditRun.id,
        stepType: "static-verification",
        toolchain,
        status:
          diagnostics.some((item) => item.level === "error") ||
          sandboxExecutionFailed ||
          sandboxResults.some((item) => item.status === "failed" || item.status === "timeout")
            ? "failed"
            : "completed",
        stdoutKey,
        stderrKey,
        summary: `${diagnostics.length} deterministic diagnostics | ${securityScanDiagnostics.length} security diagnostics | artifacts: ${diagnosticsKey}, ${sandboxKey}, ${securityScanKey}`,
        durationMs: Math.max(Date.now() - verifyStartedAt, 1)
      });

      await db.insert(verificationSteps).values({
        auditRunId: auditRun.id,
        stepType: "security-scan",
        toolchain: "sandbox-runner",
        status: plannedSecurityScans.length === 0 ? "skipped" : failedSecurityScans > 0 ? "failed" : "completed",
        stdoutKey: securityScanKey,
        stderrKey: securityScanSummaryKey,
        summary: `${securityScanDiagnostics.length} security diagnostics across ${securityScanArtifacts.length} scan(s); missing scans: ${missingSecurityScans}`,
        durationMs: Math.max(Date.now() - verifyStartedAt, 1)
      });

      workerLogger.info("verify.stage.summary-step-recorded", {
        ...context,
        diagnosticsCount: diagnostics.length,
        sandboxResultCount: sandboxResults.length
      });

      for (const sandboxResult of sandboxResults) {
        const stepStdoutKey = `verification/${auditRun.id}/sandbox/${sandboxResult.id}/stdout.txt`;
        const stepStderrKey = `verification/${auditRun.id}/sandbox/${sandboxResult.id}/stderr.txt`;

        await Promise.all([
          putObject({
            key: stepStdoutKey,
            body: sandboxResult.stdout || "No stdout output",
            contentType: "text/plain; charset=utf-8"
          }),
          putObject({
            key: stepStderrKey,
            body: sandboxResult.stderr || "No stderr output",
            contentType: "text/plain; charset=utf-8"
          })
        ]);

        await db.insert(verificationSteps).values({
          auditRunId: auditRun.id,
          stepType: sandboxResult.id,
          toolchain: "sandbox-runner",
          status:
            sandboxResult.status === "completed"
              ? "completed"
              : sandboxResult.status === "skipped"
                ? "skipped"
                : "failed",
          stdoutKey: stepStdoutKey,
          stderrKey: stepStderrKey,
          summary: `[${sandboxResult.action}] ${sandboxResult.command} ${sandboxResult.args.join(" ")}`.trim(),
          durationMs: sandboxResult.durationMs
        });
      }

      workerLogger.info("verify.stage.sandbox-steps-recorded", {
        ...context,
        sandboxResultCount: sandboxResults.length
      });

      await deps.enqueueJob(
        "audit",
        {
          projectId: job.data.projectId,
          revisionId: job.data.revisionId,
          auditRunId: auditRun.id,
          profile: job.data.profile,
          includeDocsFallbackFetch: job.data.includeDocsFallbackFetch
        },
        `audit:${job.data.projectId}:${auditRun.id}`
      );

      workerLogger.info("verify.stage.audit-enqueued", {
        ...context,
        auditJobId: `audit:${job.data.projectId}:${auditRun.id}`
      });

      await recordJobEvent({
        projectId: job.data.projectId,
        queue: "verify",
        jobId: String(job.id),
        event: "completed",
        payload: {
          auditRunId: auditRun.id,
          diagnostics: diagnostics.length,
          securityDiagnostics: securityScanDiagnostics.length
        }
      });

      workerLogger.info("verify.stage.completed", {
        ...context,
        diagnosticsCount: diagnostics.length
      });

      return { auditRunId: auditRun.id, diagnosticsCount: diagnostics.length };
    } catch (error) {
      await db
        .update(auditRuns)
        .set({
          status: "failed",
          finishedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(auditRuns.id, auditRun.id));

      await recordJobEvent({
        projectId: job.data.projectId,
        queue: "verify",
        jobId: String(job.id),
        event: "failed",
        payload: {
          auditRunId: auditRun.id,
          message: error instanceof Error ? error.message : "Unknown verify failure"
        }
      });

      workerLogger.error("verify.stage.failed", {
        ...context,
        error
      });

      throw error;
    }
  };
}
