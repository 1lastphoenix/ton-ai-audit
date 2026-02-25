"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_MODEL_ID } from "@/components/workbench/ton-workbench.constants";
import {
  canExportAuditPdf,
  createIdleAuditPipeline,
  createIdleVerifyProgress,
  createQueuedAuditPipeline,
  resolveAuditPdfStatus,
  shortId,
  toBullMqJobId,
  toFindingSeverityBucket,
} from "@/components/workbench/ton-workbench.utils";
import type {
  AuditCompareResponse,
  AuditFindingInstance,
  AuditHistoryItem,
  AuditPipelineState,
  AuditProfile,
  FindingSeverityFilter,
  VerifyProgressState,
  WorkbenchLogLevel,
} from "@/components/workbench/ton-workbench.types";

type UseWorkbenchAuditParams = {
  projectId: string;
  initialAuditId: string | null;
  modelStorageKey: string;
  normalizedModelAllowlist: string[];
  workingCopyId: string | null;
  setRevisionId: (value: string) => void;
  setWorkingCopyId: (value: string | null) => void;
  isEditable: boolean;
  setIsEditable: (value: boolean) => void;
  dirtyPaths: string[];
  setDirtyPaths: (value: string[]) => void;
  selectedPath: string | null;
  ensureWorkingCopy: () => Promise<string>;
  saveFilePath: (
    path: string,
    options?: { withoutBusy?: boolean },
  ) => Promise<boolean>;
  onError: (message: string) => void;
  onClearError: () => void;
  onActivity: (message: string) => void;
  onLog: (level: WorkbenchLogLevel, message: string) => void;
  onViewAuditFromHistory?: () => void;
};

type RunAuditQueuedJobs = {
  verifyJobId: string;
  auditJobId: string;
  lifecycleJobId: string;
};

export function useWorkbenchAudit(params: UseWorkbenchAuditParams) {
  const {
    projectId,
    initialAuditId,
    modelStorageKey,
    normalizedModelAllowlist,
    workingCopyId,
    setRevisionId,
    setWorkingCopyId,
    isEditable,
    setIsEditable,
    dirtyPaths,
    setDirtyPaths,
    selectedPath,
    ensureWorkingCopy,
    saveFilePath,
    onError,
    onClearError,
    onActivity,
    onLog,
    onViewAuditFromHistory,
  } = params;

  const [auditId, setAuditId] = useState(initialAuditId);
  const [isBusy, setIsBusy] = useState(false);
  const [findings, setFindings] = useState<AuditFindingInstance[]>([]);
  const [auditHistory, setAuditHistory] = useState<AuditHistoryItem[]>([]);
  const [isAuditHistoryLoading, setIsAuditHistoryLoading] = useState(false);
  const [findingsQuery, setFindingsQuery] = useState("");
  const [findingsSeverityFilter, setFindingsSeverityFilter] =
    useState<FindingSeverityFilter>("all");
  const [fromCompareAuditId, setFromCompareAuditId] = useState("");
  const [toCompareAuditId, setToCompareAuditId] = useState("");
  const [auditCompareResult, setAuditCompareResult] =
    useState<AuditCompareResponse | null>(null);
  const [isAuditCompareLoading, setIsAuditCompareLoading] = useState(false);
  const [primaryModelId, setPrimaryModelId] = useState(
    () => normalizedModelAllowlist[0] ?? DEFAULT_MODEL_ID,
  );
  const [fallbackModelId, setFallbackModelId] = useState(
    () =>
      normalizedModelAllowlist[1] ??
      normalizedModelAllowlist[0] ??
      DEFAULT_MODEL_ID,
  );
  const [auditProfile, setAuditProfile] = useState<AuditProfile>("deep");
  const [auditStatus, setAuditStatus] = useState<string>("idle");
  const [verifyProgress, setVerifyProgress] = useState<VerifyProgressState>(
    createIdleVerifyProgress(),
  );
  const [auditPipeline, setAuditPipeline] = useState<AuditPipelineState>(
    createIdleAuditPipeline(),
  );
  const lastAuditStatusRef = useRef<string>("idle");

  const completedAuditHistory = useMemo(
    () => auditHistory.filter((item) => item.status === "completed"),
    [auditHistory],
  );
  const activeAuditHistoryItem = useMemo(
    () => auditHistory.find((item) => item.id === auditId) ?? null,
    [auditHistory, auditId],
  );
  const findingSeveritySummary = useMemo(() => {
    const counts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      other: 0,
    };

    for (const finding of findings) {
      const bucket = toFindingSeverityBucket(
        finding.payloadJson?.severity ?? finding.severity ?? "",
      );
      counts[bucket] += 1;
    }

    const summary: Array<{
      id: Exclude<FindingSeverityFilter, "all">;
      label: string;
      count: number;
    }> = [
      { id: "critical", label: "Critical", count: counts.critical },
      { id: "high", label: "High", count: counts.high },
      { id: "medium", label: "Medium", count: counts.medium },
      { id: "low", label: "Low", count: counts.low },
    ];

    if (counts.other) {
      summary.push({ id: "other", label: "Other", count: counts.other });
    }

    return summary;
  }, [findings]);
  const findingFilterOptions = useMemo(
    () => [
      { id: "all" as const, label: "All", count: findings.length },
      ...findingSeveritySummary,
    ],
    [findingSeveritySummary, findings.length],
  );
  const filteredFindings = useMemo(() => {
    const normalizedQuery = findingsQuery.trim().toLowerCase();

    return findings.filter((finding) => {
      const severity = finding.payloadJson?.severity ?? finding.severity ?? "";
      const bucket = toFindingSeverityBucket(severity);
      if (
        findingsSeverityFilter !== "all" &&
        bucket !== findingsSeverityFilter
      ) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        finding.payloadJson?.title ?? "",
        finding.payloadJson?.summary ?? "",
        finding.payloadJson?.evidence?.filePath ?? "",
        severity,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [findings, findingsQuery, findingsSeverityFilter]);

  const loadAudit = useCallback(
    async (targetAuditId: string) => {
      const response = await fetch(
        `/api/projects/${projectId}/audits/${targetAuditId}`,
        {
          cache: "no-store",
        },
      );
      if (!response.ok) {
        throw new Error("Failed to fetch audit details");
      }

      const payload = (await response.json()) as {
        audit: { status: string };
        findings: AuditFindingInstance[];
      };

      const nextStatus = payload.audit?.status ?? "unknown";
      setAuditStatus(nextStatus);
      setFindings(payload.findings ?? []);

      if (lastAuditStatusRef.current !== nextStatus) {
        if (nextStatus === "queued") {
          onLog("info", `Audit ${shortId(targetAuditId)} queued.`);
        } else if (nextStatus === "running") {
          onLog(
            "info",
            `Audit ${shortId(targetAuditId)} running verification and analysis.`,
          );
        } else if (nextStatus === "completed") {
          onLog(
            "info",
            `Audit ${shortId(targetAuditId)} completed with ${payload.findings?.length ?? 0} finding(s).`,
          );
        } else if (nextStatus === "failed") {
          onLog("error", `Audit ${shortId(targetAuditId)} failed.`);
        }
        lastAuditStatusRef.current = nextStatus;
      }

      if (nextStatus === "completed") {
        onActivity(`Audit completed: ${payload.findings?.length ?? 0} finding(s).`);
      } else if (nextStatus === "failed") {
        onActivity("Audit failed. Check audit log for details.");
      } else if (nextStatus === "running") {
        onActivity("Audit is running.");
      } else if (nextStatus === "queued") {
        onActivity("Audit is queued and waiting for a worker.");
      }
    },
    [onActivity, onLog, projectId],
  );

  const loadAuditHistory = useCallback(async () => {
    setIsAuditHistoryLoading(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/audits`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch audit history");
      }

      const payload = (await response.json()) as {
        audits?: AuditHistoryItem[];
      };
      const nextHistory = (payload.audits ?? []).map((item) => {
        const normalizedPdfStatus =
          item.pdfStatusByVariant?.internal ??
          item.pdfStatus ??
          item.pdfStatusByVariant?.client ??
          "not_requested";
        return {
          ...item,
          profile: item.profile === "fast" ? "fast" : "deep",
          engineVersion: item.engineVersion ?? "legacy-engine",
          reportSchemaVersion:
            typeof item.reportSchemaVersion === "number" &&
            Number.isFinite(item.reportSchemaVersion)
              ? item.reportSchemaVersion
              : 1,
          pdfStatus: normalizedPdfStatus,
          pdfStatusByVariant: {
            internal: normalizedPdfStatus,
            client: item.pdfStatusByVariant?.client,
          },
        } satisfies AuditHistoryItem;
      });
      setAuditHistory(nextHistory);

      const completed = nextHistory.filter((item) => item.status === "completed");
      const newestCompletedId = completed[0]?.id ?? "";
      const previousCompletedId = completed[1]?.id ?? "";

      setFromCompareAuditId((current) => {
        if (current && completed.some((item) => item.id === current)) {
          return current;
        }

        return previousCompletedId || newestCompletedId || "";
      });

      setToCompareAuditId((current) => {
        if (current && completed.some((item) => item.id === current)) {
          return current;
        }

        return newestCompletedId || "";
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unable to load audit history");
    } finally {
      setIsAuditHistoryLoading(false);
    }
  }, [onError, projectId]);

  const viewAuditFromHistory = useCallback(
    (item: AuditHistoryItem) => {
      setRevisionId(item.revisionId);
      setAuditId(item.id);
      setAuditStatus(item.status);
      setWorkingCopyId(null);
      setIsEditable(false);
      setDirtyPaths([]);
      onActivity(`Loaded audit ${shortId(item.id)} from history.`);
      onLog(
        "info",
        `Loaded audit ${shortId(item.id)} for revision ${shortId(item.revisionId)} from history.`,
      );
      onViewAuditFromHistory?.();
    },
    [
      onActivity,
      onLog,
      onViewAuditFromHistory,
      setDirtyPaths,
      setIsEditable,
      setRevisionId,
      setWorkingCopyId,
    ],
  );

  const runAuditComparison = useCallback(async () => {
    if (!fromCompareAuditId || !toCompareAuditId) {
      onError("Select two completed audits to compare.");
      return;
    }

    if (fromCompareAuditId === toCompareAuditId) {
      onError("Select different audits for comparison.");
      return;
    }

    setIsAuditCompareLoading(true);
    onClearError();

    try {
      const search = new URLSearchParams({
        fromAuditId: fromCompareAuditId,
        toAuditId: toCompareAuditId,
      }).toString();

      const response = await fetch(
        `/api/projects/${projectId}/audits/compare?${search}`,
        {
          cache: "no-store",
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "Failed to compare audits");
      }

      const payload = (await response.json()) as AuditCompareResponse;
      setAuditCompareResult(payload);
      onActivity(
        `Compared audits ${shortId(payload.fromAudit.id)} -> ${shortId(payload.toAudit.id)}.`,
      );
      onLog(
        "info",
        `Compared audits ${shortId(payload.fromAudit.id)} -> ${shortId(payload.toAudit.id)}.`,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to compare audits");
      setAuditCompareResult(null);
    } finally {
      setIsAuditCompareLoading(false);
    }
  }, [
    fromCompareAuditId,
    onActivity,
    onClearError,
    onError,
    onLog,
    projectId,
    toCompareAuditId,
  ]);

  const runAudit = useCallback(
    async (isAuditWriteLocked: boolean): Promise<RunAuditQueuedJobs | null> => {
      if (isAuditWriteLocked) {
        onError("Audit is already queued or running for this project.");
        return null;
      }

      setVerifyProgress(createIdleVerifyProgress());
      setAuditPipeline(createQueuedAuditPipeline(auditProfile));
      setIsBusy(true);
      onClearError();
      onActivity(`Queueing ${auditProfile.toUpperCase()} audit run...`);
      onLog(
        "info",
        `Queueing ${auditProfile.toUpperCase()} audit run from current working copy.`,
      );

      try {
        const activeWorkingCopyId =
          workingCopyId ?? (isEditable ? await ensureWorkingCopy() : null);
        if (!activeWorkingCopyId) {
          throw new Error("Enable editing before running an audit.");
        }

        const pathsToPersist = dirtyPaths.length
          ? [...new Set(dirtyPaths)]
          : selectedPath
            ? [selectedPath]
            : [];
        for (const path of pathsToPersist) {
          const saved = await saveFilePath(path, { withoutBusy: true });
          if (!saved) {
            throw new Error(`Failed to save ${path} before audit`);
          }
        }

        const response = await fetch(
          `/api/projects/${projectId}/working-copies/${activeWorkingCopyId}/run-audit`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              primaryModelId,
              fallbackModelId,
              profile: auditProfile,
              includeDocsFallbackFetch: true,
            }),
          },
        );

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? "Run audit failed");
        }

        const payload = (await response.json()) as {
          revision: { id: string };
          auditRun: { id: string };
          verifyJobId: string | null;
        };

        const verifyJobId = payload.verifyJobId
          ? String(payload.verifyJobId)
          : toBullMqJobId(`verify:${projectId}:${payload.auditRun.id}`);
        const auditJobId = toBullMqJobId(
          `audit:${projectId}:${payload.auditRun.id}`,
        );
        const lifecycleJobId = toBullMqJobId(
          `finding-lifecycle:${projectId}:${payload.auditRun.id}`,
        );

        setRevisionId(payload.revision.id);
        setAuditId(payload.auditRun.id);
        setAuditStatus("queued");
        setWorkingCopyId(null);
        setIsEditable(false);
        setDirtyPaths([]);
        onActivity(`Audit ${shortId(payload.auditRun.id)} queued.`);
        onLog(
          "info",
          `${auditProfile.toUpperCase()} audit ${shortId(payload.auditRun.id)} queued for revision ${shortId(payload.revision.id)}.`,
        );
        loadAuditHistory().catch(() => undefined);

        return {
          verifyJobId,
          auditJobId,
          lifecycleJobId,
        };
      } catch (error) {
        setAuditPipeline(createIdleAuditPipeline());
        onError(error instanceof Error ? error.message : "Run audit failed");
        onLog("error", error instanceof Error ? error.message : "Run audit failed");
        return null;
      } finally {
        setIsBusy(false);
      }
    },
    [
      auditProfile,
      dirtyPaths,
      ensureWorkingCopy,
      fallbackModelId,
      isEditable,
      loadAuditHistory,
      onActivity,
      onClearError,
      onError,
      onLog,
      primaryModelId,
      projectId,
      saveFilePath,
      selectedPath,
      setDirtyPaths,
      setIsEditable,
      setRevisionId,
      setWorkingCopyId,
      workingCopyId,
    ],
  );

  const exportPdfForAudit = useCallback(
    async (targetAuditId: string) => {
      if (!targetAuditId) {
        return;
      }

      const targetAudit = auditHistory.find((item) => item.id === targetAuditId);
      const targetPdfStatus = targetAudit ? resolveAuditPdfStatus(targetAudit) : null;
      const isCompleted =
        targetAudit?.status === "completed" ||
        (targetAuditId === auditId && auditStatus === "completed");
      const canExport =
        canExportAuditPdf(targetAudit?.status, targetPdfStatus) ||
        (targetAuditId === auditId && canExportAuditPdf(auditStatus, null));
      if (!canExport) {
        const message = "PDF export is available after the audit completes.";
        onError(message);
        onActivity("Audit is still running. PDF export is unavailable.");
        onLog("warn", message);
        return;
      }

      setIsBusy(true);
      onClearError();
      onActivity("Preparing final audit PDF export...");
      onLog(
        "info",
        `Preparing final audit PDF export for audit ${shortId(targetAuditId)}.`,
      );
      try {
        const existingStatusResponse = await fetch(
          `/api/projects/${projectId}/audits/${targetAuditId}/pdf`,
          {
            cache: "no-store",
          },
        );
        if (existingStatusResponse.ok) {
          const existingStatusPayload = (await existingStatusResponse.json()) as {
            status: string;
            url: string | null;
          };
          if (existingStatusPayload.url) {
            window.open(existingStatusPayload.url, "_blank", "noopener,noreferrer");
            onActivity("Final audit PDF is ready and opened in a new tab.");
            onLog(
              "info",
              `Opened existing final audit PDF for audit ${shortId(targetAuditId)}.`,
            );
            return;
          }
        }

        if (!isCompleted) {
          throw new Error(
            "PDF is marked ready but the download URL is unavailable. Refresh and try again.",
          );
        }

        onActivity("Queueing final audit PDF export...");
        onLog(
          "info",
          `Queueing final audit PDF export for audit ${shortId(targetAuditId)}.`,
        );
        const start = await fetch(
          `/api/projects/${projectId}/audits/${targetAuditId}/pdf`,
          {
            method: "POST",
          },
        );
        if (!start.ok) {
          const startErrorPayload = (await start.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(startErrorPayload?.error ?? "Failed to queue PDF");
        }
        await start.json().catch(() => null);

        let url: string | null = null;
        let latestStatus = "queued";
        for (let attempt = 0; attempt < 60; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const statusResponse = await fetch(
            `/api/projects/${projectId}/audits/${targetAuditId}/pdf`,
            {
              cache: "no-store",
            },
          );
          if (!statusResponse.ok) {
            const statusErrorPayload = (await statusResponse
              .json()
              .catch(() => null)) as { error?: string } | null;
            throw new Error(
              statusErrorPayload?.error ?? "Failed to check PDF export status.",
            );
          }
          const statusPayload = (await statusResponse.json()) as {
            status: string;
            url: string | null;
          };
          latestStatus = statusPayload.status;

          if (statusPayload.url) {
            url = statusPayload.url;
            break;
          }

          if (statusPayload.status === "failed") {
            throw new Error("Final audit PDF generation failed on the worker.");
          }
        }

        if (!url) {
          throw new Error(
            latestStatus === "queued"
              ? "PDF is queued but not processing. Ensure worker is running, then try again."
              : "PDF generation is still running. Try again in a few moments.",
          );
        }

        window.open(url, "_blank", "noopener,noreferrer");
        onActivity("Final audit PDF is ready and opened in a new tab.");
        onLog(
          "info",
          `Final audit PDF export for audit ${shortId(targetAuditId)} completed.`,
        );
      } catch (error) {
        onError(
          error instanceof Error ? error.message : "Final audit PDF export failed",
        );
        onLog(
          "error",
          error instanceof Error ? error.message : "Final audit PDF export failed",
        );
      } finally {
        loadAuditHistory().catch(() => undefined);
        setIsBusy(false);
      }
    },
    [
      auditHistory,
      auditId,
      auditStatus,
      loadAuditHistory,
      onActivity,
      onClearError,
      onError,
      onLog,
      projectId,
    ],
  );

  useEffect(() => {
    if (!auditId) {
      return;
    }

    loadAudit(auditId).catch((error: unknown) => {
      onError(error instanceof Error ? error.message : "Unable to load findings");
    });
  }, [auditId, loadAudit, onError]);

  useEffect(() => {
    loadAuditHistory().catch(() => undefined);
  }, [loadAuditHistory]);

  useEffect(() => {
    if (!completedAuditHistory.length) {
      return;
    }

    if (fromCompareAuditId === toCompareAuditId) {
      const alternative =
        completedAuditHistory.find((item) => item.id !== fromCompareAuditId)?.id ??
        "";
      if (alternative && alternative !== toCompareAuditId) {
        setToCompareAuditId(alternative);
      }
    }
  }, [completedAuditHistory, fromCompareAuditId, toCompareAuditId]);

  useEffect(() => {
    setAuditCompareResult(null);
  }, [fromCompareAuditId, toCompareAuditId]);

  useEffect(() => {
    lastAuditStatusRef.current = "idle";
    setVerifyProgress(createIdleVerifyProgress());
    setAuditPipeline(createIdleAuditPipeline());
  }, [auditId]);

  useEffect(() => {
    setPrimaryModelId((current) =>
      normalizedModelAllowlist.includes(current)
        ? current
        : (normalizedModelAllowlist[0] ?? DEFAULT_MODEL_ID),
    );
    setFallbackModelId((current) =>
      normalizedModelAllowlist.includes(current)
        ? current
        : (normalizedModelAllowlist[1] ??
            normalizedModelAllowlist[0] ??
            DEFAULT_MODEL_ID),
    );
  }, [normalizedModelAllowlist]);

  useEffect(() => {
    const persisted = window.localStorage.getItem(modelStorageKey);
    if (!persisted) {
      return;
    }

    try {
      const parsed = JSON.parse(persisted) as {
        primaryModelId?: string;
        fallbackModelId?: string;
        auditProfile?: string;
      };

      if (
        parsed.primaryModelId &&
        normalizedModelAllowlist.includes(parsed.primaryModelId)
      ) {
        setPrimaryModelId(parsed.primaryModelId);
      }
      if (
        parsed.fallbackModelId &&
        normalizedModelAllowlist.includes(parsed.fallbackModelId)
      ) {
        setFallbackModelId(parsed.fallbackModelId);
      }
      if (parsed.auditProfile === "fast" || parsed.auditProfile === "deep") {
        setAuditProfile(parsed.auditProfile);
      }
    } catch {
      window.localStorage.removeItem(modelStorageKey);
    }
  }, [modelStorageKey, normalizedModelAllowlist]);

  useEffect(() => {
    window.localStorage.setItem(
      modelStorageKey,
      JSON.stringify({
        primaryModelId,
        fallbackModelId,
        auditProfile,
      }),
    );
  }, [auditProfile, fallbackModelId, modelStorageKey, primaryModelId]);

  const isAuditInProgress = auditStatus === "queued" || auditStatus === "running";
  const isAuditCompareActionDisabled =
    isAuditCompareLoading ||
    !fromCompareAuditId ||
    !toCompareAuditId ||
    fromCompareAuditId === toCompareAuditId;

  return {
    auditId,
    setAuditId,
    isBusy,
    findings,
    auditHistory,
    isAuditHistoryLoading,
    findingsQuery,
    setFindingsQuery,
    findingsSeverityFilter,
    setFindingsSeverityFilter,
    fromCompareAuditId,
    setFromCompareAuditId,
    toCompareAuditId,
    setToCompareAuditId,
    auditCompareResult,
    isAuditCompareLoading,
    primaryModelId,
    setPrimaryModelId,
    fallbackModelId,
    setFallbackModelId,
    auditProfile,
    setAuditProfile,
    auditStatus,
    setAuditStatus,
    verifyProgress,
    setVerifyProgress,
    auditPipeline,
    setAuditPipeline,
    completedAuditHistory,
    activeAuditHistoryItem,
    findingFilterOptions,
    filteredFindings,
    isAuditInProgress,
    isAuditCompareActionDisabled,
    loadAudit,
    loadAuditHistory,
    viewAuditFromHistory,
    runAuditComparison,
    runAudit,
    exportPdfForAudit,
  };
}
