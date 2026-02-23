import { Job } from "bullmq";
import { and, eq } from "drizzle-orm";

import {
  auditRuns,
  type JobPayloadMap,
  verificationSteps
} from "@ton-audit/shared";

import { db } from "../db";
import { recordJobEvent } from "../job-events";
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

export function createVerifyProcessor(deps: { enqueueJob: EnqueueJob }) {
  return async function verify(job: Job<JobPayloadMap["verify"]>) {
    await recordJobEvent({
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

    await db
      .update(auditRuns)
      .set({
        status: "running",
        startedAt: auditRun.startedAt ?? new Date(),
        updatedAt: new Date()
      })
      .where(eq(auditRuns.id, auditRun.id));

    try {
      const files = await loadRevisionFilesWithContent(job.data.revisionId);
      const toolchain = detectToolchain(files);
      const diagnostics = collectDeterministicDiagnostics(files);
      const plan = planSandboxVerification(
        files.map((file) => ({
          path: file.path,
          content: file.content
        }))
      );

      let sandboxExecutionSummary = "Sandbox execution skipped";
      let sandboxResults: Awaited<ReturnType<typeof executeSandboxPlan>>["results"] = [];

      if (plan.steps.length > 0) {
        try {
          const execution = await executeSandboxPlan({
            files: files.map((file) => ({ path: file.path, content: file.content })),
            plan,
            projectId: job.data.projectId,
            revisionId: job.data.revisionId
          });

          sandboxResults = execution.results;
          const summary = summarizeSandboxResults(execution.results);
          sandboxExecutionSummary = [
            `Sandbox mode: ${execution.mode}`,
            `Adapter: ${plan.adapter}`,
            `Completed: ${summary.completed}`,
            `Failed: ${summary.failed}`,
            `Skipped: ${summary.skipped}`,
            `Timeout: ${summary.timeout}`
          ].join(" | ");
        } catch (sandboxError) {
          sandboxExecutionSummary = `Sandbox execution unavailable: ${
            sandboxError instanceof Error ? sandboxError.message : "Unknown error"
          }`;
        }
      }

      const stdout = [
        `Verification toolchain: ${toolchain}`,
        `Files scanned: ${files.length}`,
        `Diagnostics generated: ${diagnostics.length}`,
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
        })
      ]);

      const startedAt = new Date();

      await db.insert(verificationSteps).values({
        auditRunId: auditRun.id,
        stepType: "static-verification",
        toolchain,
        status:
          diagnostics.some((item) => item.level === "error") ||
          sandboxResults.some((item) => item.status === "failed" || item.status === "timeout")
            ? "failed"
            : "completed",
        stdoutKey,
        stderrKey,
        summary: `${diagnostics.length} deterministic diagnostics | ${sandboxExecutionSummary}`,
        durationMs: Math.max(Date.now() - startedAt.getTime(), 1)
      });

      for (const sandboxResult of sandboxResults) {
        const stepStdoutKey = `verification/${auditRun.id}/sandbox/${sandboxResult.name}/stdout.txt`;
        const stepStderrKey = `verification/${auditRun.id}/sandbox/${sandboxResult.name}/stderr.txt`;

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
          stepType: sandboxResult.name,
          toolchain: "sandbox-runner",
          status:
            sandboxResult.status === "completed"
              ? "completed"
              : sandboxResult.status === "skipped"
                ? "skipped"
                : "failed",
          stdoutKey: stepStdoutKey,
          stderrKey: stepStderrKey,
          summary: `${sandboxResult.command} ${sandboxResult.args.join(" ")}`.trim(),
          durationMs: sandboxResult.durationMs
        });
      }

      await deps.enqueueJob(
        "audit",
        {
          projectId: job.data.projectId,
          revisionId: job.data.revisionId,
          auditRunId: auditRun.id,
          includeDocsFallbackFetch: job.data.includeDocsFallbackFetch
        },
        `audit:${job.data.projectId}:${auditRun.id}`
      );

      await recordJobEvent({
        queue: "verify",
        jobId: String(job.id),
        event: "completed",
        payload: {
          auditRunId: auditRun.id,
          diagnostics: diagnostics.length
        }
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
        queue: "verify",
        jobId: String(job.id),
        event: "failed",
        payload: {
          auditRunId: auditRun.id,
          message: error instanceof Error ? error.message : "Unknown verify failure"
        }
      });

      throw error;
    }
  };
}
