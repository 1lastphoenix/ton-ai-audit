"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  finalizeAuditPipeline,
  normalizeAuditProfile,
  parseVerifyProgressStep,
  parseVerifyProgressSteps,
  summarizeVerifyProgress,
  toBullMqJobId,
  updateAuditPipelineStage,
  withAuditPipelineProfile,
} from "@/components/workbench/ton-workbench.utils";
import type {
  AuditPipelineStageId,
  AuditPipelineState,
  BackendJobEvent,
  VerifyProgressPhase,
  VerifyProgressState,
  WorkbenchLogLevel,
} from "@/components/workbench/ton-workbench.types";

type UseWorkbenchEventsParams = {
  projectId: string;
  auditId: string | null;
  auditStatus: string;
  isAuditInProgress: boolean;
  setAuditStatus: (status: string) => void;
  setVerifyProgress: Dispatch<SetStateAction<VerifyProgressState>>;
  setAuditPipeline: Dispatch<SetStateAction<AuditPipelineState>>;
  loadAudit: (targetAuditId: string) => Promise<void>;
  loadAuditHistory: () => Promise<void>;
  onActivity: (message: string) => void;
  onLog: (level: WorkbenchLogLevel, message: string) => void;
};

export function useWorkbenchEvents(params: UseWorkbenchEventsParams) {
  const {
    projectId,
    auditId,
    auditStatus,
    isAuditInProgress,
    setAuditStatus,
    setVerifyProgress,
    setAuditPipeline,
    loadAudit,
    loadAuditHistory,
    onActivity,
    onLog,
  } = params;
  const [jobState, setJobState] = useState<string>("idle");
  const [registeredJobIds, setRegisteredJobIds] = useState<string[]>([]);
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const lastBackendEventAtRef = useRef<number>(0);
  const staleBackendWarningShownRef = useRef(false);

  const registerJobIds = useCallback(
    (jobIds: Array<string | null | undefined>) => {
      const normalized = jobIds
        .map((item) => (item ? toBullMqJobId(String(item).trim()) : ""))
        .filter(Boolean);

      if (!normalized.length) {
        return;
      }

      setRegisteredJobIds((current) =>
        [...new Set([...current, ...normalized])].slice(-48),
      );
      lastBackendEventAtRef.current = Date.now();
      staleBackendWarningShownRef.current = false;
    },
    [],
  );
  useEffect(() => {
    lastBackendEventAtRef.current = Date.now();
  }, []);

  const activeJobIds = useMemo(() => {
    const ids = [...registeredJobIds];
    if (auditId && isAuditInProgress) {
      ids.push(
        toBullMqJobId(`verify:${projectId}:${auditId}`),
        toBullMqJobId(`audit:${projectId}:${auditId}`),
        toBullMqJobId(`finding-lifecycle:${projectId}:${auditId}`),
      );
    }
    return [...new Set(ids)].slice(-48);
  }, [auditId, isAuditInProgress, projectId, registeredJobIds]);

  useEffect(() => {
    const currentSources = eventSourcesRef.current;
    const knownIds = new Set(activeJobIds);

    for (const jobId of activeJobIds) {
      if (currentSources.has(jobId)) {
        continue;
      }

      const stream = new EventSource(
        `/api/jobs/${encodeURIComponent(jobId)}/events?projectId=${projectId}`,
      );
      let hadConnectionError = false;

      stream.onopen = () => {
        if (hadConnectionError) {
          onLog("info", `Job event stream reconnected: ${jobId}.`);
          hadConnectionError = false;
        }
      };

      stream.onmessage = (event) => {
        let payload: BackendJobEvent;
        try {
          payload = JSON.parse(event.data) as BackendJobEvent;
        } catch {
          return;
        }

        const messageFromPayload =
          typeof payload.payload?.message === "string"
            ? payload.payload.message
            : null;
        const eventMessage = `[${payload.queue}] ${payload.event}${
          messageFromPayload ? `: ${messageFromPayload}` : ""
        }`;
        const isFailureEvent =
          payload.event === "failed" ||
          payload.event === "worker-failed" ||
          payload.event === "timeout";

        onLog(isFailureEvent ? "error" : "info", eventMessage);
        setJobState(`${payload.queue}:${payload.event}`);
        lastBackendEventAtRef.current = Date.now();
        staleBackendWarningShownRef.current = false;

        if (payload.queue === "verify") {
          const verifyPayload =
            payload.payload && typeof payload.payload === "object"
              ? (payload.payload as Record<string, unknown>)
              : {};
          const verifyDataPayload =
            verifyPayload.data && typeof verifyPayload.data === "object"
              ? (verifyPayload.data as Record<string, unknown>)
              : null;
          const verifyProfile = normalizeAuditProfile(
            verifyPayload.profile ?? verifyDataPayload?.profile,
          );

          if (verifyProfile) {
            setAuditPipeline((current) =>
              withAuditPipelineProfile(current, verifyProfile),
            );
          }

          if (payload.event === "progress") {
            const phase =
              typeof verifyPayload.phase === "string"
                ? verifyPayload.phase
                : null;
            const totalSteps =
              typeof verifyPayload.totalSteps === "number" &&
              Number.isFinite(verifyPayload.totalSteps)
                ? Math.max(0, Math.trunc(verifyPayload.totalSteps))
                : null;
            const currentStepId =
              typeof verifyPayload.currentStepId === "string"
                ? verifyPayload.currentStepId
                : null;
            const toolchain =
              typeof verifyPayload.toolchain === "string"
                ? verifyPayload.toolchain
                : null;
            const sandboxAdapter =
              typeof verifyPayload.sandboxAdapter === "string"
                ? verifyPayload.sandboxAdapter
                : null;
            const mode =
              typeof verifyPayload.mode === "string"
                ? verifyPayload.mode
                : null;
            const progressSteps = parseVerifyProgressSteps(verifyPayload.steps);

            setVerifyProgress((current) => {
              const nextSteps = progressSteps.length
                ? progressSteps
                : current.steps;
              const nextTotalSteps =
                totalSteps ?? Math.max(nextSteps.length, current.totalSteps);
              let nextPhase: VerifyProgressPhase = current.phase;
              if (
                phase === "security-scan" ||
                phase === "plan-ready" ||
                phase === "sandbox-running" ||
                phase === "sandbox-completed" ||
                phase === "sandbox-failed" ||
                phase === "sandbox-skipped"
              ) {
                nextPhase = phase;
              }

              let nextCurrentStepId = currentStepId ?? current.currentStepId;
              if (nextPhase === "sandbox-running" && !nextCurrentStepId) {
                nextCurrentStepId =
                  nextSteps.find(
                    (step) =>
                      step.status === "running" || step.status === "pending",
                  )?.id ?? null;
              }
              if (
                nextPhase === "sandbox-completed" ||
                nextPhase === "sandbox-failed" ||
                nextPhase === "sandbox-skipped"
              ) {
                nextCurrentStepId = null;
              }

              return {
                phase: nextPhase,
                totalSteps: nextTotalSteps,
                currentStepId: nextCurrentStepId,
                toolchain: toolchain ?? current.toolchain,
                sandboxAdapter: sandboxAdapter ?? current.sandboxAdapter,
                mode: mode ?? current.mode,
                steps: nextSteps,
              };
            });

            setAuditPipeline((current) => {
              let next = verifyProfile
                ? withAuditPipelineProfile(current, verifyProfile)
                : current;
              if (next.status === "idle" || next.status === "queued") {
                next = {
                  ...next,
                  status: "running",
                };
              }

              if (phase === "plan-ready") {
                const detailParts = [
                  toolchain ? `Toolchain ${toolchain}` : null,
                  sandboxAdapter ? `Adapter ${sandboxAdapter}` : null,
                  `Steps ${totalSteps ?? progressSteps.length}`,
                ].filter((item): item is string => Boolean(item));
                return updateAuditPipelineStage(next, {
                  stageId: "verify-plan",
                  status: "completed",
                  detail: detailParts.join(" | "),
                  makeCurrent: false,
                });
              }

              if (phase === "security-scan") {
                const scanStatus =
                  typeof verifyPayload.status === "string"
                    ? verifyPayload.status
                    : "running";
                const completedScans =
                  typeof verifyPayload.completedScans === "number" &&
                  Number.isFinite(verifyPayload.completedScans)
                    ? Math.max(0, Math.trunc(verifyPayload.completedScans))
                    : null;
                const failedScans =
                  typeof verifyPayload.failedScans === "number" &&
                  Number.isFinite(verifyPayload.failedScans)
                    ? Math.max(0, Math.trunc(verifyPayload.failedScans))
                    : null;
                const diagnostics =
                  typeof verifyPayload.diagnostics === "number" &&
                  Number.isFinite(verifyPayload.diagnostics)
                    ? Math.max(0, Math.trunc(verifyPayload.diagnostics))
                    : null;
                if (scanStatus === "started" || scanStatus === "running") {
                  return updateAuditPipelineStage(next, {
                    stageId: "security-scans",
                    status: "running",
                    detail: "Executing deterministic security scanners.",
                  });
                }

                return updateAuditPipelineStage(next, {
                  stageId: "security-scans",
                  status:
                    scanStatus === "completed_with_failures" ||
                    (failedScans ?? 0) > 0
                      ? "failed"
                      : "completed",
                  detail: [
                    completedScans !== null
                      ? `Completed ${completedScans}`
                      : null,
                    failedScans !== null ? `Failed ${failedScans}` : null,
                    diagnostics !== null ? `Diagnostics ${diagnostics}` : null,
                  ]
                    .filter((item): item is string => Boolean(item))
                    .join(" | "),
                  makeCurrent: false,
                });
              }

              if (phase === "sandbox-running") {
                const runningStep =
                  progressSteps.find((step) => step.status === "running") ??
                  (currentStepId
                    ? progressSteps.find((step) => step.id === currentStepId)
                    : (progressSteps[0] ?? null));
                const runningStepIndex = runningStep
                  ? progressSteps.findIndex((step) => step.id === runningStep.id) + 1
                  : 1;
                const runningTotal = totalSteps ?? progressSteps.length;
                return updateAuditPipelineStage(next, {
                  stageId: "sandbox-checks",
                  status: "running",
                  detail: runningStep
                    ? `${runningStep.id} (${runningStepIndex}/${runningTotal || 1})`
                    : "Running sandbox checks.",
                });
              }

              if (phase === "sandbox-completed") {
                const completed =
                  typeof verifyPayload.completed === "number" &&
                  Number.isFinite(verifyPayload.completed)
                    ? Math.max(0, Math.trunc(verifyPayload.completed))
                    : null;
                const failed =
                  typeof verifyPayload.failed === "number" &&
                  Number.isFinite(verifyPayload.failed)
                    ? Math.max(0, Math.trunc(verifyPayload.failed))
                    : null;
                const skipped =
                  typeof verifyPayload.skipped === "number" &&
                  Number.isFinite(verifyPayload.skipped)
                    ? Math.max(0, Math.trunc(verifyPayload.skipped))
                    : null;
                const timeout =
                  typeof verifyPayload.timeout === "number" &&
                  Number.isFinite(verifyPayload.timeout)
                    ? Math.max(0, Math.trunc(verifyPayload.timeout))
                    : null;
                const hasSandboxFailures =
                  (failed ?? 0) > 0 || (timeout ?? 0) > 0;
                return updateAuditPipelineStage(next, {
                  stageId: "sandbox-checks",
                  status: hasSandboxFailures ? "failed" : "completed",
                  detail: [
                    completed !== null ? `Passed ${completed}` : null,
                    failed !== null ? `Failed ${failed}` : null,
                    skipped !== null ? `Skipped ${skipped}` : null,
                    timeout !== null ? `Timeout ${timeout}` : null,
                  ]
                    .filter((item): item is string => Boolean(item))
                    .join(" | "),
                  makeCurrent: false,
                });
              }

              if (phase === "sandbox-failed") {
                const message =
                  typeof verifyPayload.message === "string"
                    ? verifyPayload.message
                    : "Sandbox execution failed.";
                return updateAuditPipelineStage(next, {
                  stageId: "sandbox-checks",
                  status: "failed",
                  detail: message,
                  makeCurrent: false,
                });
              }

              if (phase === "sandbox-skipped") {
                return updateAuditPipelineStage(next, {
                  stageId: "sandbox-checks",
                  status: "skipped",
                  detail: "No sandbox checks were planned.",
                  makeCurrent: false,
                });
              }

              return next;
            });

            if (phase === "plan-ready") {
              onActivity(
                totalSteps && totalSteps > 0
                  ? `Verification plan ready: ${totalSteps} sandbox step(s).`
                  : "Verification plan ready: static checks only.",
              );
            } else if (phase === "security-scan") {
              const scanStatus =
                typeof verifyPayload.status === "string"
                  ? verifyPayload.status
                  : "running";
              const scanDiagnostics =
                typeof verifyPayload.diagnostics === "number" &&
                Number.isFinite(verifyPayload.diagnostics)
                  ? Math.max(0, Math.trunc(verifyPayload.diagnostics))
                  : null;
              onActivity(
                scanStatus.startsWith("completed")
                  ? `Security scans completed${scanDiagnostics !== null ? `: ${scanDiagnostics} diagnostic(s).` : "."}`
                  : "Security scans running.",
              );
            } else if (phase === "sandbox-running") {
              const runningStep =
                progressSteps.find((step) => step.status === "running") ??
                (currentStepId
                  ? progressSteps.find((step) => step.id === currentStepId)
                  : (progressSteps[0] ?? null));
              const runningStepIndex = runningStep
                ? progressSteps.findIndex(
                    (step) => step.id === runningStep.id,
                  ) + 1
                : 1;
              const runningTotal = totalSteps ?? progressSteps.length;
              onActivity(
                runningStep
                  ? `Verification sandbox running: ${runningStep.id} (${runningStepIndex}/${runningTotal || 1}).`
                  : "Verification sandbox is running.",
              );
            } else if (phase === "sandbox-completed") {
              const completed =
                typeof verifyPayload.completed === "number" &&
                Number.isFinite(verifyPayload.completed)
                  ? Math.max(0, Math.trunc(verifyPayload.completed))
                  : null;
              const failed =
                typeof verifyPayload.failed === "number" &&
                Number.isFinite(verifyPayload.failed)
                  ? Math.max(0, Math.trunc(verifyPayload.failed))
                  : summarizeVerifyProgress(progressSteps).failed;
              const timeout =
                typeof verifyPayload.timeout === "number" &&
                Number.isFinite(verifyPayload.timeout)
                  ? Math.max(0, Math.trunc(verifyPayload.timeout))
                  : summarizeVerifyProgress(progressSteps).timeout;
              const finishedSteps =
                completed ?? summarizeVerifyProgress(progressSteps).completed;
              onActivity(
                failed > 0 || timeout > 0
                  ? `Verification sandbox completed with issues: passed ${finishedSteps}, failed ${failed}, timeout ${timeout}.`
                  : `Verification sandbox completed: ${finishedSteps}/${totalSteps ?? progressSteps.length} step(s) passed.`,
              );
            } else if (phase === "sandbox-failed") {
              const progressError =
                typeof verifyPayload.message === "string"
                  ? verifyPayload.message
                  : "Sandbox execution failed.";
              onActivity(
                `Verification sandbox failed: ${progressError}`,
              );
            } else if (phase === "sandbox-skipped") {
              onActivity(
                "Verification completed without sandbox steps.",
              );
            }

            return;
          }

          if (payload.event === "sandbox-step") {
            const stepPayload = parseVerifyProgressStep(
              verifyPayload.step,
              `step-${Date.now().toString(36)}`,
            );
            if (stepPayload) {
              setVerifyProgress((current) => {
                const nextSteps = [...current.steps];
                const existingIndex = nextSteps.findIndex(
                  (step) => step.id === stepPayload.id,
                );
                if (existingIndex >= 0) {
                  nextSteps[existingIndex] = {
                    ...nextSteps[existingIndex],
                    ...stepPayload,
                  };
                } else {
                  nextSteps.push(stepPayload);
                }

                const nextCurrentStepId =
                  nextSteps.find(
                    (step) =>
                      step.status === "running" || step.status === "pending",
                  )?.id ?? null;
                const nextTotalSteps = Math.max(
                  current.totalSteps,
                  nextSteps.length,
                );
                const nextSummary = summarizeVerifyProgress(nextSteps);
                const nextResolvedCount =
                  nextSummary.completed +
                  nextSummary.failed +
                  nextSummary.skipped +
                  nextSummary.timeout;

                return {
                  ...current,
                  phase:
                    nextTotalSteps > 0 && nextResolvedCount >= nextTotalSteps
                      ? "sandbox-completed"
                      : "sandbox-running",
                  totalSteps: nextTotalSteps,
                  currentStepId: nextCurrentStepId,
                  steps: nextSteps,
                };
              });
              onActivity(
                `Verification step ${stepPayload.id}: ${stepPayload.status}.`,
              );
              setAuditPipeline((current) => {
                let next = verifyProfile
                  ? withAuditPipelineProfile(current, verifyProfile)
                  : current;
                if (next.status === "idle" || next.status === "queued") {
                  next = {
                    ...next,
                    status: "running",
                  };
                }

                return updateAuditPipelineStage(next, {
                  stageId: "sandbox-checks",
                  status:
                    stepPayload.status === "failed" ||
                    stepPayload.status === "timeout"
                      ? "failed"
                      : stepPayload.status === "completed"
                        ? "running"
                        : "running",
                  detail: `${stepPayload.id} is ${stepPayload.status}.`,
                });
              });
            }
            return;
          }

          if (
            payload.event === "started" ||
            payload.event === "worker-started"
          ) {
            setVerifyProgress((current) => ({
              ...current,
              phase: current.phase === "idle" ? "plan-ready" : current.phase,
            }));
            onActivity("Verification started.");
            setAuditPipeline((current) => {
              const next = verifyProfile
                ? withAuditPipelineProfile(current, verifyProfile)
                : current;
              return {
                ...next,
                status:
                  next.status === "idle" || next.status === "queued"
                    ? "running"
                    : next.status,
              };
            });
          } else if (
            payload.event === "completed" ||
            payload.event === "worker-completed"
          ) {
            setVerifyProgress((current) => ({
              ...current,
              phase: "completed",
              currentStepId: null,
            }));
            onActivity(
              "Verification completed. Waiting for audit stage...",
            );
            setAuditPipeline((current) => {
              let next = verifyProfile
                ? withAuditPipelineProfile(current, verifyProfile)
                : current;

              if (next.stages["verify-plan"].status === "pending") {
                next = updateAuditPipelineStage(next, {
                  stageId: "verify-plan",
                  status: "completed",
                  detail: "Verification completed.",
                  makeCurrent: false,
                });
              }
              if (next.stages["security-scans"].status === "pending") {
                next = updateAuditPipelineStage(next, {
                  stageId: "security-scans",
                  status: "skipped",
                  detail: "No security scans executed.",
                  makeCurrent: false,
                });
              }
              if (next.stages["sandbox-checks"].status === "pending") {
                next = updateAuditPipelineStage(next, {
                  stageId: "sandbox-checks",
                  status: "skipped",
                  detail: "No sandbox checks executed.",
                  makeCurrent: false,
                });
              }
              return {
                ...next,
                status: next.status === "idle" ? "running" : next.status,
                currentStageId:
                  next.currentStageId === "verify-plan" ||
                  next.currentStageId === "security-scans" ||
                  next.currentStageId === "sandbox-checks"
                    ? null
                    : next.currentStageId,
              };
            });
          } else if (isFailureEvent) {
            const verifyError =
              typeof verifyPayload.message === "string"
                ? verifyPayload.message
                : "Verification failed.";
            setVerifyProgress((current) => ({
              ...current,
              phase: "failed",
              currentStepId: null,
            }));
            onActivity(`Verification failed: ${verifyError}`);
            setAuditPipeline((current) => {
              let next = verifyProfile
                ? withAuditPipelineProfile(current, verifyProfile)
                : current;
              const activeVerifyStage: AuditPipelineStageId =
                next.currentStageId === "verify-plan" ||
                next.currentStageId === "security-scans" ||
                next.currentStageId === "sandbox-checks"
                  ? next.currentStageId
                  : next.stages["sandbox-checks"].status === "running"
                    ? "sandbox-checks"
                    : next.stages["security-scans"].status === "running"
                      ? "security-scans"
                      : "verify-plan";
              next = updateAuditPipelineStage(next, {
                stageId: activeVerifyStage,
                status: "failed",
                detail: verifyError,
                makeCurrent: false,
              });
              return {
                ...next,
                status: "failed",
                currentStageId: null,
              };
            });
          }
          return;
        }

        if (payload.queue === "audit") {
          const auditPayload =
            payload.payload && typeof payload.payload === "object"
              ? (payload.payload as Record<string, unknown>)
              : {};
          const auditDataPayload =
            auditPayload.data && typeof auditPayload.data === "object"
              ? (auditPayload.data as Record<string, unknown>)
              : null;
          const auditProfilePayload = normalizeAuditProfile(
            auditPayload.profile ?? auditDataPayload?.profile,
          );
          if (auditProfilePayload) {
            setAuditPipeline((current) =>
              withAuditPipelineProfile(current, auditProfilePayload),
            );
          }

          if (payload.event === "progress") {
            const auditPhase =
              typeof auditPayload.phase === "string" ? auditPayload.phase : null;
            if (auditPhase === "agent-discovery") {
              const modelId =
                typeof auditPayload.modelId === "string"
                  ? auditPayload.modelId
                  : null;
              setAuditPipeline((current) =>
                updateAuditPipelineStage(
                  auditProfilePayload
                    ? withAuditPipelineProfile(current, auditProfilePayload)
                    : current,
                  {
                    stageId: "agent-discovery",
                    status: "running",
                    detail: modelId
                      ? `Model ${modelId}`
                      : "ToolLoop discovery pass is running.",
                  },
                ),
              );
              onActivity("Audit discovery pass is running.");
              return;
            }

            if (auditPhase === "agent-validation") {
              const modelId =
                typeof auditPayload.modelId === "string"
                  ? auditPayload.modelId
                  : null;
              setAuditPipeline((current) =>
                updateAuditPipelineStage(
                  auditProfilePayload
                    ? withAuditPipelineProfile(current, auditProfilePayload)
                    : current,
                  {
                    stageId: "agent-validation",
                    status: "running",
                    detail: modelId
                      ? `Model ${modelId}`
                      : "Adversarial validation pass is running.",
                  },
                ),
              );
              onActivity("Audit validation pass is running.");
              return;
            }

            if (auditPhase === "agent-synthesis") {
              const candidateCount =
                typeof auditPayload.candidateCount === "number" &&
                Number.isFinite(auditPayload.candidateCount)
                  ? Math.max(0, Math.trunc(auditPayload.candidateCount))
                  : null;
              setAuditPipeline((current) =>
                updateAuditPipelineStage(
                  auditProfilePayload
                    ? withAuditPipelineProfile(current, auditProfilePayload)
                    : current,
                  {
                    stageId: "agent-synthesis",
                    status: "running",
                    detail:
                      candidateCount !== null
                        ? `Synthesizing ${candidateCount} candidate(s).`
                        : "Final synthesis pass is running.",
                  },
                ),
              );
              onActivity("Audit synthesis pass is running.");
              return;
            }

            if (auditPhase === "report-quality-gate") {
              const passed = auditPayload.passed === true;
              const failuresCount = Array.isArray(auditPayload.failures)
                ? auditPayload.failures.length
                : 0;
              setAuditPipeline((current) => {
                let next = auditProfilePayload
                  ? withAuditPipelineProfile(current, auditProfilePayload)
                  : current;
                next = updateAuditPipelineStage(next, {
                  stageId: "quality-gate",
                  status: "running",
                  detail: "Evaluating quality gates.",
                });
                return updateAuditPipelineStage(next, {
                  stageId: "quality-gate",
                  status: passed ? "completed" : "failed",
                  detail: passed
                    ? "Quality gates passed."
                    : `Quality gate rejected (${failuresCount} issue(s)).`,
                  makeCurrent: false,
                });
              });
              onActivity(
                passed
                  ? "Report quality gates passed."
                  : "Report quality gate rejected. Retrying model pass.",
              );
              return;
            }
          }

          if (
            payload.event === "started" ||
            payload.event === "worker-started"
          ) {
            setAuditStatus("running");
            onActivity("Audit analysis is running.");
            setAuditPipeline((current) => {
              const next = auditProfilePayload
                ? withAuditPipelineProfile(current, auditProfilePayload)
                : current;
              return {
                ...next,
                status:
                  next.status === "idle" || next.status === "queued"
                    ? "running"
                    : next.status,
              };
            });
          } else if (
            payload.event === "completed" ||
            payload.event === "worker-completed"
          ) {
            setAuditStatus("completed");
            onActivity("Audit completed.");
            setAuditPipeline((current) =>
              finalizeAuditPipeline(current, "completed"),
            );
            if (auditId) {
              loadAudit(auditId).catch(() => undefined);
            }
            loadAuditHistory().catch(() => undefined);
          } else if (isFailureEvent) {
            const auditError =
              typeof auditPayload.message === "string"
                ? auditPayload.message
                : "Audit failed.";
            setAuditStatus("failed");
            onActivity(`Audit failed: ${auditError}`);
            setAuditPipeline((current) =>
              finalizeAuditPipeline(current, "failed", auditError),
            );
            loadAuditHistory().catch(() => undefined);
          }
          return;
        }

        if (payload.queue === "finding-lifecycle") {
          if (
            payload.event === "completed" ||
            payload.event === "worker-completed"
          ) {
            onActivity("Finding lifecycle mapping completed.");
            if (auditId) {
              loadAudit(auditId).catch(() => undefined);
            }
            loadAuditHistory().catch(() => undefined);
          }
          return;
        }

        if (payload.queue === "pdf") {
          if (
            payload.event === "started" ||
            payload.event === "worker-started"
          ) {
            onActivity("PDF export is running.");
          } else if (
            payload.event === "completed" ||
            payload.event === "worker-completed"
          ) {
            onActivity("PDF export completed.");
            loadAuditHistory().catch(() => undefined);
          } else if (isFailureEvent) {
            onActivity("PDF export failed.");
            loadAuditHistory().catch(() => undefined);
          }
        }
      };

      stream.onerror = () => {
        if (hadConnectionError) {
          return;
        }
        hadConnectionError = true;
        onLog(
          "warn",
          `Job event stream error for ${jobId}. If this persists, check worker/API health.`,
        );
      };

      currentSources.set(jobId, stream);
    }

    for (const [jobId, source] of currentSources.entries()) {
      if (knownIds.has(jobId)) {
        continue;
      }
      source.close();
      currentSources.delete(jobId);
    }
  }, [
    activeJobIds,
    auditId,
    loadAudit,
    loadAuditHistory,
    onActivity,
    projectId,
    onLog,
    setAuditPipeline,
    setAuditStatus,
    setVerifyProgress,
  ]);

  useEffect(() => {
    if (!isAuditInProgress) {
      return;
    }

    const interval = window.setInterval(() => {
      const elapsedMs = Date.now() - lastBackendEventAtRef.current;
      if (elapsedMs < 30_000 || staleBackendWarningShownRef.current) {
        return;
      }

      staleBackendWarningShownRef.current = true;
      onActivity(
        "Audit is queued but no backend worker events were received for 30s.",
      );
      onLog(
        "warn",
        "No backend job events for 30s while audit is queued/running. Worker may be offline.",
      );
    }, 5_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [isAuditInProgress, onActivity, onLog]);

  useEffect(() => {
    if (!auditId || (auditStatus !== "queued" && auditStatus !== "running")) {
      return;
    }

    let cancelled = false;
    const interval = window.setInterval(() => {
      if (cancelled) {
        return;
      }

      loadAudit(auditId).catch(() => undefined);
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [auditId, auditStatus, loadAudit]);


  useEffect(() => {
    const currentSources = eventSourcesRef.current;

    return () => {
      for (const source of currentSources.values()) {
        source.close();
      }
      currentSources.clear();
    };
  }, []);

  return {
    jobState,
    setJobState,
    registerJobIds,
  };
}
