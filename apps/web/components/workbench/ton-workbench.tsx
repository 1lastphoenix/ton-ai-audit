"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import type { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useTheme } from "next-themes";
import {
  FileCode2,
  FilePlus2,
  FolderTree,
  MoreHorizontal,
  RefreshCcw,
  Shield,
  TerminalSquare,
  Upload,
  X,
} from "lucide-react";

import {
  detectLanguageFromPath,
  type Language,
  normalizePath,
} from "@ton-audit/shared";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  registerTonLanguages,
  startTonLspClient,
  type TonLspStatus,
} from "@/lib/editor/ton-lsp-client";
import { cn } from "@/lib/utils";
import {
  filterWorkbenchTree,
  resolveMonacoTheme,
} from "@/components/workbench/workbench-ui-utils";
import { WorkbenchExecutionTracker } from "@/components/workbench/workbench-execution-tracker";
import { WorkbenchAuditHistoryList } from "@/components/workbench/workbench-audit-history-list";
import { WorkbenchTopToolbar } from "@/components/workbench/workbench-top-toolbar";
import { WorkbenchFindingsPanel } from "@/components/workbench/workbench-findings-panel";
import {
  auditPipelineStageDefinitions,
  DEFAULT_MODEL_ID,
  DEFAULT_NEW_FILE_NAME,
  bottomPanelTabConfig,
  rightPanelTabConfig,
} from "@/components/workbench/ton-workbench.constants";
import {
  auditPipelineStageStatusClass,
  auditStatusBadgeClass,
  buildLspWebSocketUrls,
  buildTreeFromPaths,
  canExportAuditPdf,
  collectDirectoryPaths,
  createIdleAuditPipeline,
  createIdleVerifyProgress,
  createQueuedAuditPipeline,
  finalizeAuditPipeline,
  formatSeverityLabel,
  getFileName,
  getParentDirectories,
  isFindingSeverityFilter,
  normalizeAuditProfile,
  normalizeModelAllowlist,
  parseVerifyProgressStep,
  parseVerifyProgressSteps,
  pdfStatusBadgeClass,
  resolveAuditPdfStatus,
  resolveMonacoLanguage,
  severityBadgeClass,
  shortId,
  summarizeVerifyProgress,
  toAuditPipelineStageStatusLabel,
  toAuditPipelineStatusLabel,
  toAuditStatusLabel,
  toBullMqJobId,
  toFindingSeverityBucket,
  toPdfStatusLabel,
  toProfileLabel,
  treeFiles,
  updateAuditPipelineStage,
  verifyProgressPhaseLabel,
  verifyStepStatusClass,
  withAuditPipelineProfile,
  workbenchLogLevelClass,
} from "@/components/workbench/ton-workbench.utils";
import { MonacoEditor } from "@/components/workbench/workbench-monaco-editor";
import { RailToggleButton } from "@/components/workbench/workbench-rail-toggle-button";
import { TreeView } from "@/components/workbench/workbench-tree-view";
import type {
  AuditCompareResponse,
  AuditFindingInstance,
  AuditHistoryItem,
  AuditPipelineStageId,
  AuditPipelineState,
  AuditPipelineStatus,
  AuditProfile,
  BackendJobEvent,
  ExplorerActionConfig,
  FindingSeverityFilter,
  RailToggleConfig,
  RightPanelTab,
  TonWorkbenchProps,
  TreeNode,
  VerifyProgressPhase,
  VerifyProgressState,
  WorkbenchFileEntry,
  WorkbenchLogEntry,
  WorkbenchLogLevel,
} from "@/components/workbench/ton-workbench.types";

export function TonWorkbench(props: TonWorkbenchProps) {
  const {
    projectId,
    projectName,
    initialRevisionId,
    initialAuditId,
    initialWorkingCopyId,
    modelAllowlist,
  } = props;
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const normalizedModelAllowlist = useMemo(() => {
    const normalized = normalizeModelAllowlist(modelAllowlist);
    return normalized.length ? normalized : [DEFAULT_MODEL_ID];
  }, [modelAllowlist]);

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const lspClientRef = useRef<{ dispose: () => Promise<void> | void } | null>(
    null,
  );
  const explorerFilterInputRef = useRef<HTMLInputElement | null>(null);
  const [revisionId, setRevisionId] = useState(initialRevisionId);
  const [auditId, setAuditId] = useState(initialAuditId);
  const [workingCopyId, setWorkingCopyId] = useState<string | null>(
    initialWorkingCopyId,
  );
  const [isEditable, setIsEditable] = useState(Boolean(initialWorkingCopyId));
  const [isBusy, setIsBusy] = useState(false);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [expandedDirectories, setExpandedDirectories] = useState<string[]>([]);
  const [dirtyPaths, setDirtyPaths] = useState<string[]>([]);
  const [fileCache, setFileCache] = useState<
    Record<string, WorkbenchFileEntry>
  >({});
  const [findings, setFindings] = useState<AuditFindingInstance[]>([]);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("findings");
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
  const [jobState, setJobState] = useState<string>("idle");
  const [auditStatus, setAuditStatus] = useState<string>("idle");
  const [lspStatus, setLspStatus] = useState<TonLspStatus>("idle");
  const [lspErrorDetail, setLspErrorDetail] = useState<string | null>(null);
  const [activityMessage, setActivityMessage] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [bottomPanelTab, setBottomPanelTab] = useState<
    "audit-log" | "problems"
  >("audit-log");
  const [activityFeed, setActivityFeed] = useState<WorkbenchLogEntry[]>([]);
  const [verifyProgress, setVerifyProgress] = useState<VerifyProgressState>(
    createIdleVerifyProgress(),
  );
  const [auditPipeline, setAuditPipeline] = useState<AuditPipelineState>(
    createIdleAuditPipeline(),
  );
  const [activeJobIds, setActiveJobIds] = useState<string[]>([]);
  const [isInlineNewFile, setIsInlineNewFile] = useState(false);
  const [inlineNewFileName, setInlineNewFileName] = useState(
    DEFAULT_NEW_FILE_NAME,
  );
  const [inlineNewFileParentPath, setInlineNewFileParentPath] = useState<
    string | null
  >(null);
  const [contextMenuTargetNode, setContextMenuTargetNode] = useState<{
    path: string;
    type: "file" | "directory";
  } | null>(null);
  const [explorerQuery, setExplorerQuery] = useState("");
  const [isExplorerVisible, setIsExplorerVisible] = useState(true);
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(true);
  const [isFindingsVisible, setIsFindingsVisible] = useState(true);
  const [prefersDark, setPrefersDark] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const inlineNewFileRowRef = useRef<HTMLDivElement | null>(null);
  const newFileInputRef = useRef<HTMLInputElement | null>(null);
  const fileCacheRef = useRef<Record<string, WorkbenchFileEntry>>({});
  const lastAuditStatusRef = useRef<string>("idle");
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const lastBackendEventAtRef = useRef<number>(Date.now());
  const staleBackendWarningShownRef = useRef(false);

  const uploadInputId = useId();
  const modelStorageKey = `ton-audit:model-selection:${projectId}`;
  const allFiles = useMemo(() => treeFiles(tree), [tree]);
  const expandedDirectorySet = useMemo(
    () => new Set(expandedDirectories),
    [expandedDirectories],
  );
  const dirtyPathSet = useMemo(() => new Set(dirtyPaths), [dirtyPaths]);
  const currentFile = selectedPath ? fileCache[selectedPath] : null;
  const currentMonacoLanguage = useMemo(
    () =>
      resolveMonacoLanguage({
        filePath: selectedPath,
        language: currentFile?.language,
      }),
    [currentFile?.language, selectedPath],
  );
  const auditStatusLabel = toAuditStatusLabel(auditStatus);
  const isAuditInProgress =
    auditStatus === "queued" || auditStatus === "running";
  const isAuditWriteLocked = isAuditInProgress || jobState === "queuing";
  const verifyProgressSummary = useMemo(
    () => summarizeVerifyProgress(verifyProgress.steps),
    [verifyProgress.steps],
  );
  const verifyProgressTotalSteps =
    verifyProgress.totalSteps || verifyProgress.steps.length;
  const verifyProgressResolvedSteps =
    verifyProgressSummary.completed +
    verifyProgressSummary.failed +
    verifyProgressSummary.skipped +
    verifyProgressSummary.timeout;
  const verifyProgressPercent =
    verifyProgressTotalSteps > 0
      ? Math.round(
          (verifyProgressResolvedSteps / verifyProgressTotalSteps) * 100,
        )
      : 0;
  const verifyProgressCurrentStep = useMemo(() => {
    if (!verifyProgress.currentStepId) {
      return null;
    }

    return (
      verifyProgress.steps.find(
        (step) => step.id === verifyProgress.currentStepId,
      ) ?? null
    );
  }, [verifyProgress.currentStepId, verifyProgress.steps]);
  const shouldShowVerifyProgress =
    verifyProgress.phase !== "idle" ||
    verifyProgressTotalSteps > 0 ||
    verifyProgress.steps.length > 0;
  const auditPipelineStages = useMemo(
    () =>
      auditPipelineStageDefinitions.map((definition) => ({
        ...definition,
        ...auditPipeline.stages[definition.id],
      })),
    [auditPipeline.stages],
  );
  const auditPipelineTotalStages = auditPipelineStages.length;
  const auditPipelineResolvedStages = auditPipelineStages.filter(
    (stage) =>
      stage.status === "completed" ||
      stage.status === "failed" ||
      stage.status === "skipped",
  ).length;
  const auditPipelinePercent =
    auditPipelineTotalStages > 0
      ? Math.round((auditPipelineResolvedStages / auditPipelineTotalStages) * 100)
      : 0;
  const auditPipelineCurrentStage = useMemo(() => {
    if (!auditPipeline.currentStageId) {
      return null;
    }

    return (
      auditPipelineStages.find((stage) => stage.id === auditPipeline.currentStageId) ??
      null
    );
  }, [auditPipeline.currentStageId, auditPipelineStages]);
  const shouldShowExecutionTracker =
    shouldShowVerifyProgress ||
    auditPipeline.status !== "idle" ||
    isAuditInProgress;
  const executionTrackerStatus: AuditPipelineStatus =
    auditPipeline.status !== "idle"
      ? auditPipeline.status
      : auditStatus === "queued"
        ? "queued"
        : auditStatus === "running"
          ? "running"
          : auditStatus === "failed"
            ? "failed"
          : auditStatus === "completed"
              ? "completed"
              : "idle";
  const executionTrackerProfileLabel = auditPipeline.profile
    ? toProfileLabel(auditPipeline.profile)
    : null;
  const executionTrackerActiveLabel =
    verifyProgressCurrentStep?.id ?? auditPipelineCurrentStage?.label ?? null;
  const executionTrackerStageRows = useMemo(
    () =>
      auditPipelineStages.map((stage) => ({
        ...stage,
        isCurrent: auditPipeline.currentStageId === stage.id,
      })),
    [auditPipeline.currentStageId, auditPipelineStages],
  );
  const executionTrackerVerifyRows = useMemo(
    () =>
      verifyProgress.steps.map((step) => ({
        ...step,
        isCurrent: verifyProgressCurrentStep?.id === step.id,
      })),
    [verifyProgress.steps, verifyProgressCurrentStep?.id],
  );
  const executionTrackerVerifyFailed =
    verifyProgress.phase === "failed" || verifyProgress.phase === "sandbox-failed";
  const filteredTree = useMemo(
    () => filterWorkbenchTree(tree, explorerQuery),
    [tree, explorerQuery],
  );
  const filteredFilePaths = useMemo(
    () => treeFiles(filteredTree),
    [filteredTree],
  );
  const contextMenuParentPath = useMemo(() => {
    if (!contextMenuTargetNode) {
      return null;
    }

    if (contextMenuTargetNode.type === "directory") {
      return contextMenuTargetNode.path;
    }

    const parents = getParentDirectories(contextMenuTargetNode.path);
    return parents[parents.length - 1] ?? null;
  }, [contextMenuTargetNode]);
  const monacoTheme = useMemo(
    () => resolveMonacoTheme({ resolvedTheme, prefersDark }),
    [prefersDark, resolvedTheme],
  );
  const workbenchGridClassName = useMemo(() => {
    if (isExplorerVisible && isFindingsVisible) {
      return "lg:grid-cols-[48px_260px_minmax(0,1fr)_320px]";
    }

    if (isExplorerVisible) {
      return "lg:grid-cols-[48px_260px_minmax(0,1fr)]";
    }

    if (isFindingsVisible) {
      return "lg:grid-cols-[48px_minmax(0,1fr)_320px]";
    }

    return "lg:grid-cols-[48px_minmax(0,1fr)]";
  }, [isExplorerVisible, isFindingsVisible]);
  const treeViewExpandedDirectories = useMemo(() => {
    if (!explorerQuery.trim()) {
      return expandedDirectorySet;
    }

    return new Set(collectDirectoryPaths(filteredTree));
  }, [expandedDirectorySet, explorerQuery, filteredTree]);
  const lspProblemMessage = useMemo(() => {
    if (lspStatus === "error") {
      return lspErrorDetail
        ? `LSP connection failed: ${lspErrorDetail}`
        : "LSP connection failed. Language diagnostics and completions are unavailable.";
    }

    if (lspStatus === "disconnected") {
      return "LSP disconnected. Diagnostics may be stale until the editor reconnects.";
    }

    return null;
  }, [lspErrorDetail, lspStatus]);
  const problemItems = useMemo(() => {
    const items: string[] = [];
    if (lastError) {
      items.push(lastError);
    }
    if (lspProblemMessage) {
      items.push(lspProblemMessage);
    }
    if (auditStatus === "failed") {
      items.push("Audit run failed. Open worker logs and retry.");
    }
    return [...new Set(items)];
  }, [auditStatus, lastError, lspProblemMessage]);
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
  const isAuditCompareActionDisabled =
    isAuditCompareLoading ||
    !fromCompareAuditId ||
    !toCompareAuditId ||
    fromCompareAuditId === toCompareAuditId;
  const handleRightPanelTabChange = useCallback((nextTab: string) => {
    if (nextTab === "findings" || nextTab === "audit-history") {
      setRightPanelTab(nextTab);
    }
  }, []);

  useEffect(() => {
    fileCacheRef.current = fileCache;
  }, [fileCache]);

  const pushWorkbenchLog = useCallback(
    (level: WorkbenchLogLevel, message: string) => {
      const entry: WorkbenchLogEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        createdAt: new Date().toISOString(),
        level,
        message,
      };

      setActivityFeed((current) => [entry, ...current].slice(0, 150));
    },
    [],
  );

  const registerJobIds = useCallback(
    (jobIds: Array<string | null | undefined>) => {
      const normalized = jobIds
        .map((item) => (item ? toBullMqJobId(String(item).trim()) : ""))
        .filter(Boolean);

      if (!normalized.length) {
        return;
      }

      setActiveJobIds((current) =>
        [...new Set([...current, ...normalized])].slice(-48),
      );
      lastBackendEventAtRef.current = Date.now();
      staleBackendWarningShownRef.current = false;
    },
    [],
  );

  const openFileInEditor = useCallback((path: string) => {
    setSelectedPath(path);
    setOpenTabs((current) =>
      current.includes(path) ? current : [...current, path],
    );
    const parents = getParentDirectories(path);
    if (parents.length) {
      setExpandedDirectories((current) => [
        ...new Set([...current, ...parents]),
      ]);
    }
  }, []);

  const revealFindingInEditor = useCallback(
    (finding: AuditFindingInstance) => {
      const path = finding.payloadJson?.evidence?.filePath;
      if (path) {
        openFileInEditor(path);
      }
      const line = finding.payloadJson?.evidence?.startLine;
      if (line && editorRef.current) {
        editorRef.current.revealLineInCenter(line);
        editorRef.current.setPosition({
          lineNumber: line,
          column: 1,
        });
      }
    },
    [openFileInEditor],
  );

  const toggleDirectory = useCallback((path: string) => {
    setExpandedDirectories((current) =>
      current.includes(path)
        ? current.filter((entry) => entry !== path)
        : [...current, path],
    );
  }, []);

  const closeOpenTab = useCallback((path: string) => {
    setOpenTabs((current) => {
      const closedIndex = current.findIndex((entry) => entry === path);
      if (closedIndex < 0) {
        return current;
      }

      const next = current.filter((entry) => entry !== path);
      setSelectedPath((currentSelected) => {
        if (currentSelected !== path) {
          return currentSelected;
        }

        return next[closedIndex] ?? next[closedIndex - 1] ?? next[0] ?? null;
      });

      return next;
    });
  }, []);

  const loadTree = useCallback(
    async (targetRevisionId: string) => {
      const sourceUrl = workingCopyId
        ? `/api/projects/${projectId}/working-copies/${workingCopyId}/tree`
        : `/api/projects/${projectId}/revisions/${targetRevisionId}/tree`;
      const response = await fetch(
        sourceUrl,
        {
          cache: "no-store",
        },
      );
      if (!response.ok) {
        throw new Error("Failed to fetch file tree");
      }
      const payload = (await response.json()) as { tree: TreeNode[] };
      setTree(payload.tree);
      const firstFile = treeFiles(payload.tree)[0] ?? null;
      setSelectedPath((current) => current ?? firstFile);
      return payload.tree;
    },
    [projectId, workingCopyId],
  );

  const loadFile = useCallback(
    async (path: string, options?: { force?: boolean }) => {
      if (!revisionId && !workingCopyId) {
        return;
      }
      if (!options?.force && fileCacheRef.current[path]) {
        return;
      }

      const search = new URLSearchParams({ path }).toString();
      const sourceUrl = workingCopyId
        ? `/api/projects/${projectId}/working-copies/${workingCopyId}/file?${search}`
        : `/api/projects/${projectId}/revisions/${revisionId}/file?${search}`;
      const response = await fetch(
        sourceUrl,
        {
          cache: "no-store",
        },
      );
      if (!response.ok) {
        throw new Error("Failed to fetch file");
      }
      const payload = (await response.json()) as {
        file: { path: string; content: string; language: Language };
      };

      setFileCache((current) => ({
        ...current,
        [payload.file.path]: {
          content: payload.file.content,
          language: payload.file.language,
        },
      }));
    },
    [projectId, revisionId, workingCopyId],
  );

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
          pushWorkbenchLog("info", `Audit ${shortId(targetAuditId)} queued.`);
        } else if (nextStatus === "running") {
          pushWorkbenchLog(
            "info",
            `Audit ${shortId(targetAuditId)} running verification and analysis.`,
          );
        } else if (nextStatus === "completed") {
          pushWorkbenchLog(
            "info",
            `Audit ${shortId(targetAuditId)} completed with ${payload.findings?.length ?? 0} finding(s).`,
          );
        } else if (nextStatus === "failed") {
          pushWorkbenchLog("error", `Audit ${shortId(targetAuditId)} failed.`);
        }
        lastAuditStatusRef.current = nextStatus;
      }

      if (nextStatus === "completed") {
        setActivityMessage(
          `Audit completed: ${payload.findings?.length ?? 0} finding(s).`,
        );
      } else if (nextStatus === "failed") {
        setActivityMessage("Audit failed. Check audit log for details.");
      } else if (nextStatus === "running") {
        setActivityMessage("Audit is running.");
      } else if (nextStatus === "queued") {
        setActivityMessage("Audit is queued and waiting for a worker.");
      }
    },
    [projectId, pushWorkbenchLog],
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
            client: item.pdfStatusByVariant?.client
          }
        } satisfies AuditHistoryItem;
      });
      setAuditHistory(nextHistory);

      const completed = nextHistory.filter(
        (item) => item.status === "completed",
      );
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
      setLastError(
        error instanceof Error ? error.message : "Unable to load audit history",
      );
    } finally {
      setIsAuditHistoryLoading(false);
    }
  }, [projectId]);

  const viewAuditFromHistory = useCallback(
    (item: AuditHistoryItem) => {
      setRevisionId(item.revisionId);
      setAuditId(item.id);
      setAuditStatus(item.status);
      setWorkingCopyId(null);
      setIsEditable(false);
      setDirtyPaths([]);
      setRightPanelTab("findings");
      setActivityMessage(`Loaded audit ${shortId(item.id)} from history.`);
      pushWorkbenchLog(
        "info",
        `Loaded audit ${shortId(item.id)} for revision ${shortId(item.revisionId)} from history.`,
      );
    },
    [pushWorkbenchLog],
  );

  const runAuditComparison = useCallback(async () => {
    if (!fromCompareAuditId || !toCompareAuditId) {
      setLastError("Select two completed audits to compare.");
      return;
    }

    if (fromCompareAuditId === toCompareAuditId) {
      setLastError("Select different audits for comparison.");
      return;
    }

    setIsAuditCompareLoading(true);
    setLastError(null);

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
      setActivityMessage(
        `Compared audits ${shortId(payload.fromAudit.id)} -> ${shortId(payload.toAudit.id)}.`,
      );
      pushWorkbenchLog(
        "info",
        `Compared audits ${shortId(payload.fromAudit.id)} -> ${shortId(payload.toAudit.id)}.`,
      );
    } catch (error) {
      setLastError(
        error instanceof Error ? error.message : "Failed to compare audits",
      );
      setAuditCompareResult(null);
    } finally {
      setIsAuditCompareLoading(false);
    }
  }, [fromCompareAuditId, projectId, pushWorkbenchLog, toCompareAuditId]);

  useEffect(() => {
    fileCacheRef.current = {};
    setFileCache({});
    setOpenTabs([]);
    setDirtyPaths([]);
    setSelectedPath(null);
  }, [revisionId]);

  useEffect(() => {
    fileCacheRef.current = {};
    setFileCache({});
    setDirtyPaths([]);
  }, [workingCopyId]);

  useEffect(() => {
    if (!revisionId) {
      return;
    }

    loadTree(revisionId).catch((error: unknown) => {
      setLastError(
        error instanceof Error ? error.message : "Unable to load revision tree",
      );
    });
  }, [revisionId, loadTree]);

  useEffect(() => {
    if (!selectedPath) {
      return;
    }

    loadFile(selectedPath).catch((error: unknown) => {
      setLastError(
        error instanceof Error ? error.message : "Unable to load file",
      );
    });
  }, [selectedPath, loadFile]);

  useEffect(() => {
    if (!auditId) {
      return;
    }

    loadAudit(auditId).catch((error: unknown) => {
      setLastError(
        error instanceof Error ? error.message : "Unable to load findings",
      );
    });
  }, [auditId, loadAudit]);

  useEffect(() => {
    loadAuditHistory().catch(() => undefined);
  }, [loadAuditHistory]);

  useEffect(() => {
    if (!completedAuditHistory.length) {
      return;
    }

    if (fromCompareAuditId === toCompareAuditId) {
      const alternative =
        completedAuditHistory.find((item) => item.id !== fromCompareAuditId)
          ?.id ?? "";
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
    if (!auditId || !isAuditInProgress) {
      return;
    }

    registerJobIds([
      toBullMqJobId(`verify:${projectId}:${auditId}`),
      toBullMqJobId(`audit:${projectId}:${auditId}`),
      toBullMqJobId(`finding-lifecycle:${projectId}:${auditId}`),
    ]);
  }, [auditId, isAuditInProgress, projectId, registerJobIds]);

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
          pushWorkbenchLog("info", `Job event stream reconnected: ${jobId}.`);
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

        pushWorkbenchLog(isFailureEvent ? "error" : "info", eventMessage);
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
              setActivityMessage(
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
              setActivityMessage(
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
              setActivityMessage(
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
              setActivityMessage(
                failed > 0 || timeout > 0
                  ? `Verification sandbox completed with issues: passed ${finishedSteps}, failed ${failed}, timeout ${timeout}.`
                  : `Verification sandbox completed: ${finishedSteps}/${totalSteps ?? progressSteps.length} step(s) passed.`,
              );
            } else if (phase === "sandbox-failed") {
              const progressError =
                typeof verifyPayload.message === "string"
                  ? verifyPayload.message
                  : "Sandbox execution failed.";
              setActivityMessage(
                `Verification sandbox failed: ${progressError}`,
              );
            } else if (phase === "sandbox-skipped") {
              setActivityMessage(
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
              setActivityMessage(
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
            setActivityMessage("Verification started.");
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
            setActivityMessage(
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
            setActivityMessage(`Verification failed: ${verifyError}`);
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
              setActivityMessage("Audit discovery pass is running.");
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
              setActivityMessage("Audit validation pass is running.");
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
              setActivityMessage("Audit synthesis pass is running.");
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
              setActivityMessage(
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
            setActivityMessage("Audit analysis is running.");
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
            setActivityMessage("Audit completed.");
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
            setActivityMessage(`Audit failed: ${auditError}`);
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
            setActivityMessage("Finding lifecycle mapping completed.");
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
            setActivityMessage("PDF export is running.");
          } else if (
            payload.event === "completed" ||
            payload.event === "worker-completed"
          ) {
            setActivityMessage("PDF export completed.");
            loadAuditHistory().catch(() => undefined);
          } else if (isFailureEvent) {
            setActivityMessage("PDF export failed.");
            loadAuditHistory().catch(() => undefined);
          }
        }
      };

      stream.onerror = () => {
        if (hadConnectionError) {
          return;
        }
        hadConnectionError = true;
        pushWorkbenchLog(
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
    projectId,
    pushWorkbenchLog,
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
      setActivityMessage(
        "Audit is queued but no backend worker events were received for 30s.",
      );
      pushWorkbenchLog(
        "warn",
        "No backend job events for 30s while audit is queued/running. Worker may be offline.",
      );
    }, 5_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [isAuditInProgress, pushWorkbenchLog]);

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
    if (!selectedPath) {
      return;
    }

    setOpenTabs((current) =>
      current.includes(selectedPath) ? current : [...current, selectedPath],
    );
  }, [selectedPath]);

  useEffect(() => {
    const availablePaths = new Set(allFiles);
    setOpenTabs((current) => {
      const next = current.filter((path) => availablePaths.has(path));
      if (next.length === current.length) {
        return current;
      }

      setSelectedPath((currentSelected) => {
        if (!currentSelected || !availablePaths.has(currentSelected)) {
          return next[0] ?? null;
        }
        return currentSelected;
      });

      return next;
    });
    setDirtyPaths((current) =>
      current.filter((path) => availablePaths.has(path)),
    );
  }, [allFiles]);

  useEffect(() => {
    const directoryPaths = collectDirectoryPaths(tree);
    setExpandedDirectories((current) => {
      if (!directoryPaths.length) {
        return [];
      }

      if (!current.length) {
        return directoryPaths;
      }

      return current.filter((entry) => directoryPaths.includes(entry));
    });
  }, [tree]);

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

  useEffect(() => {
    const currentSources = eventSourcesRef.current;

    return () => {
      if (lspClientRef.current) {
        void lspClientRef.current.dispose();
        lspClientRef.current = null;
      }

      for (const source of currentSources.values()) {
        source.close();
      }
      currentSources.clear();
    };
  }, []);

  useEffect(() => {
    pushWorkbenchLog("info", `Workspace opened for project "${projectName}".`);
  }, [projectName, pushWorkbenchLog]);

  useEffect(() => {
    if (!isInlineNewFile) {
      return;
    }

    newFileInputRef.current?.focus();
    newFileInputRef.current?.select();
  }, [isInlineNewFile]);

  useEffect(() => {
    if (!isInlineNewFile) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (inlineNewFileRowRef.current?.contains(target)) {
        return;
      }

      setIsInlineNewFile(false);
      setInlineNewFileName(DEFAULT_NEW_FILE_NAME);
      setInlineNewFileParentPath(null);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [isInlineNewFile]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const computePrefersDark = () => {
      const hasDarkClass = document.documentElement.classList.contains("dark");
      setPrefersDark(hasDarkClass || mediaQuery.matches);
    };

    computePrefersDark();

    const handleChange = () => {
      computePrefersDark();
    };
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }

    const observer = new MutationObserver(() => {
      computePrefersDark();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    setCursorPosition({ line: 1, column: 1 });
  }, [selectedPath]);

  const onEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    registerTonLanguages(monaco);

    editor.onDidChangeCursorPosition((event) => {
      setCursorPosition({
        line: event.position.lineNumber,
        column: event.position.column,
      });
    });

    if (!lspClientRef.current) {
      const wsUrls = buildLspWebSocketUrls(
        process.env.NEXT_PUBLIC_TON_LSP_WS_URL,
      );
      lspClientRef.current = startTonLspClient({
        wsUrls,
        onStatus: (status) => {
          setLspStatus(status);
          if (status === "connected") {
            setLspErrorDetail(null);
          }
        },
        onError: (message) => {
          setLspErrorDetail(message);
        },
      });
    }
  };

  const ensureWorkingCopy = useCallback(async () => {
    if (!revisionId) {
      throw new Error("No revision available for editing");
    }

    if (workingCopyId) {
      return workingCopyId;
    }

    const response = await fetch(
      `/api/projects/${projectId}/revisions/${revisionId}/working-copy`,
      {
        method: "POST",
      },
    );
    if (!response.ok) {
      throw new Error("Failed to create working copy");
    }

    const payload = (await response.json()) as { workingCopy: { id: string } };
    setWorkingCopyId(payload.workingCopy.id);
    return payload.workingCopy.id;
  }, [projectId, revisionId, workingCopyId]);

  async function enableEditing() {
    if (isAuditWriteLocked) {
      setLastError("Editing is disabled while an audit is queued or running.");
      pushWorkbenchLog(
        "warn",
        "Edit mode blocked while audit is queued/running.",
      );
      return;
    }

    setIsBusy(true);
    setLastError(null);
    try {
      await ensureWorkingCopy();
      setIsEditable(true);
      setActivityMessage("Editing enabled.");
      pushWorkbenchLog("info", "Editing mode enabled.");
    } catch (error) {
      setLastError(
        error instanceof Error ? error.message : "Unable to enable editing",
      );
      pushWorkbenchLog(
        "error",
        error instanceof Error ? error.message : "Unable to enable editing",
      );
    } finally {
      setIsBusy(false);
    }
  }

  function switchToReadOnlyMode() {
    setIsEditable(false);
    setActivityMessage("Read-only mode enabled.");
    pushWorkbenchLog("info", "Read-only mode enabled.");
  }

  async function toggleEditMode() {
    if (isEditable) {
      switchToReadOnlyMode();
      return;
    }

    await enableEditing();
  }

  const saveFilePath = useCallback(
    async (path: string, options?: { withoutBusy?: boolean }) => {
      const fileEntry = fileCache[path];
      if (!fileEntry) {
        return false;
      }

      if (!options?.withoutBusy) {
        setIsBusy(true);
      }
      setLastError(null);

      try {
        const activeWorkingCopyId =
          workingCopyId ?? (isEditable ? await ensureWorkingCopy() : null);
        if (!activeWorkingCopyId) {
          throw new Error("Enable editing before saving.");
        }

        const response = await fetch(
          `/api/projects/${projectId}/working-copies/${activeWorkingCopyId}/file`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              path,
              content: fileEntry.content,
            }),
          },
        );
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? "Save failed");
        }

        setDirtyPaths((current) => current.filter((entry) => entry !== path));
        if (!options?.withoutBusy) {
          setActivityMessage(`Saved ${getFileName(path)}.`);
        }
        return true;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Save failed");
        pushWorkbenchLog(
          "error",
          error instanceof Error ? error.message : "Save failed",
        );
        return false;
      } finally {
        if (!options?.withoutBusy) {
          setIsBusy(false);
        }
      }
    },
    [
      ensureWorkingCopy,
      fileCache,
      isEditable,
      projectId,
      pushWorkbenchLog,
      workingCopyId,
    ],
  );

  const saveCurrentFile = useCallback(
    async (options?: { withoutBusy?: boolean }) => {
      if (!selectedPath) {
        return false;
      }

      return saveFilePath(selectedPath, options);
    },
    [saveFilePath, selectedPath],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const hasModifier = event.ctrlKey || event.metaKey;
      if (!hasModifier) {
        return;
      }

      const normalizedKey = event.key.toLowerCase();
      const isQuickOpenShortcut = !event.shiftKey && normalizedKey === "p";
      if (isQuickOpenShortcut) {
        event.preventDefault();
        setIsExplorerVisible(true);
        explorerFilterInputRef.current?.focus();
        explorerFilterInputRef.current?.select();
        return;
      }

      const isToggleExplorerShortcut = !event.shiftKey && normalizedKey === "b";
      if (isToggleExplorerShortcut) {
        event.preventDefault();
        setIsExplorerVisible((current) => !current);
        return;
      }

      const isToggleBottomPanelShortcut =
        !event.shiftKey && normalizedKey === "j";
      if (isToggleBottomPanelShortcut) {
        event.preventDefault();
        setIsBottomPanelVisible((current) => !current);
        return;
      }

      const isFocusExplorerShortcut = event.shiftKey && normalizedKey === "e";
      if (isFocusExplorerShortcut) {
        event.preventDefault();
        setIsExplorerVisible(true);
        explorerFilterInputRef.current?.focus();
        explorerFilterInputRef.current?.select();
        return;
      }

      const isSaveShortcut = !event.shiftKey && normalizedKey === "s";
      if (!isSaveShortcut) {
        return;
      }

      event.preventDefault();
      if (
        isAuditWriteLocked ||
        !isEditable ||
        isBusy ||
        !selectedPath ||
        !dirtyPathSet.has(selectedPath)
      ) {
        return;
      }

      void saveCurrentFile();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    dirtyPathSet,
    isAuditWriteLocked,
    isBusy,
    isEditable,
    saveCurrentFile,
    selectedPath,
  ]);

  async function runAudit() {
    if (isAuditWriteLocked) {
      setLastError("Audit is already queued or running for this project.");
      return;
    }

    setVerifyProgress(createIdleVerifyProgress());
    setAuditPipeline(createQueuedAuditPipeline(auditProfile));
    setIsBusy(true);
    setJobState("queuing");
    setLastError(null);
    setActivityMessage(`Queueing ${auditProfile.toUpperCase()} audit run...`);
    pushWorkbenchLog(
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

      registerJobIds([verifyJobId, auditJobId, lifecycleJobId]);
      setJobState(verifyJobId);
      setRevisionId(payload.revision.id);
      setAuditId(payload.auditRun.id);
      setAuditStatus("queued");
      setWorkingCopyId(null);
      setIsEditable(false);
      setDirtyPaths([]);
      setActivityMessage(`Audit ${shortId(payload.auditRun.id)} queued.`);
      pushWorkbenchLog(
        "info",
        `${auditProfile.toUpperCase()} audit ${shortId(payload.auditRun.id)} queued for revision ${shortId(payload.revision.id)}.`,
      );
      loadAuditHistory().catch(() => undefined);
    } catch (error) {
      setAuditPipeline(createIdleAuditPipeline());
      setLastError(error instanceof Error ? error.message : "Run audit failed");
      pushWorkbenchLog(
        "error",
        error instanceof Error ? error.message : "Run audit failed",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function exportPdfForAudit(targetAuditId: string) {
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
      setLastError(message);
      setActivityMessage("Audit is still running. PDF export is unavailable.");
      pushWorkbenchLog("warn", message);
      return;
    }

    setIsBusy(true);
    setLastError(null);
    setActivityMessage("Preparing final audit PDF export...");
    pushWorkbenchLog(
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
          setActivityMessage("Final audit PDF is ready and opened in a new tab.");
          pushWorkbenchLog(
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

      setActivityMessage("Queueing final audit PDF export...");
      pushWorkbenchLog(
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
      const startPayload = (await start.json()) as { jobId?: string | number };
      if (startPayload.jobId) {
        registerJobIds([String(startPayload.jobId)]);
      }

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
      setActivityMessage("Final audit PDF is ready and opened in a new tab.");
      pushWorkbenchLog(
        "info",
        `Final audit PDF export for audit ${shortId(targetAuditId)} completed.`,
      );
    } catch (error) {
      setLastError(
        error instanceof Error
          ? error.message
          : "Final audit PDF export failed",
      );
      pushWorkbenchLog(
        "error",
        error instanceof Error
          ? error.message
          : "Final audit PDF export failed",
      );
    } finally {
      loadAuditHistory().catch(() => undefined);
      setIsBusy(false);
    }
  }

  function refreshWorkbenchData() {
    if (!revisionId) {
      return;
    }

    const candidatePaths = [
      ...new Set(
        [...openTabs, selectedPath].filter((path): path is string =>
          Boolean(path),
        ),
      ),
    ];

    setIsBusy(true);
    setLastError(null);

    void (async () => {
      try {
        const nextTree = await loadTree(revisionId);
        const availablePaths = new Set(treeFiles(nextTree));
        const pathsToReload = candidatePaths.filter((path) =>
          availablePaths.has(path),
        );

        await Promise.all(
          pathsToReload.map((path) => loadFile(path, { force: true })),
        );

        if (auditId) {
          await loadAudit(auditId);
        }
        await loadAuditHistory();

        setDirtyPaths([]);
        setActivityMessage("Workbench refreshed.");
        pushWorkbenchLog("info", "Workbench refreshed.");
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Refresh failed");
      } finally {
        setIsBusy(false);
      }
    })();
  }

  async function createNewFile(pathInput: string) {
    if (isAuditWriteLocked) {
      setLastError("Cannot create files while an audit is queued or running.");
      return;
    }

    const normalized = normalizePath(pathInput);
    if (!normalized || normalized.includes("..")) {
      setLastError("Provide a valid relative file path.");
      return;
    }

    setIsBusy(true);
    setLastError(null);
    try {
      const activeWorkingCopyId = await ensureWorkingCopy();
      const response = await fetch(
        `/api/projects/${projectId}/working-copies/${activeWorkingCopyId}/file`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            path: normalized,
            content: "",
          }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to create file");
      }

      setIsEditable(true);
      setFileCache((current) => ({
        ...current,
        [normalized]: {
          content: "",
          language: detectLanguageFromPath(normalized),
        },
      }));
      setTree((current) =>
        buildTreeFromPaths([...new Set([...treeFiles(current), normalized])]),
      );
      openFileInEditor(normalized);
      setInlineNewFileName(DEFAULT_NEW_FILE_NAME);
      setInlineNewFileParentPath(null);
      setIsInlineNewFile(false);
    } catch (error) {
      setLastError(
        error instanceof Error ? error.message : "Failed to create file",
      );
    } finally {
      setIsBusy(false);
    }
  }

  function startInlineNewFile(parentPath?: string | null) {
    if (isAuditWriteLocked) {
      setLastError("Cannot create files while an audit is queued or running.");
      return;
    }

    const selectedParents = selectedPath
      ? getParentDirectories(selectedPath)
      : [];
    const selectedParentPath =
      selectedParents[selectedParents.length - 1] ?? null;
    const targetParentPath =
      parentPath === undefined ? selectedParentPath : parentPath;

    setInlineNewFileParentPath(targetParentPath);
    setInlineNewFileName(DEFAULT_NEW_FILE_NAME);
    setExplorerQuery("");
    setIsInlineNewFile(true);

    if (!targetParentPath) {
      return;
    }

    const pathsToExpand = [
      ...getParentDirectories(targetParentPath),
      targetParentPath,
    ];
    setExpandedDirectories((current) => [
      ...new Set([...current, ...pathsToExpand]),
    ]);
  }

  function cancelInlineNewFile() {
    setIsInlineNewFile(false);
    setInlineNewFileName(DEFAULT_NEW_FILE_NAME);
    setInlineNewFileParentPath(null);
  }

  function submitInlineNewFile() {
    const trimmedName = inlineNewFileName.trim();
    if (!trimmedName) {
      setLastError("Provide a valid relative file path.");
      return;
    }

    const composedPath = inlineNewFileParentPath
      ? `${inlineNewFileParentPath}/${trimmedName}`
      : trimmedName;
    void createNewFile(composedPath);
  }

  function openUploadPicker() {
    const input = document.getElementById(uploadInputId);
    if (input instanceof HTMLInputElement) {
      input.click();
    }
  }

  async function uploadFilesToWorkingCopy(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    if (isAuditWriteLocked) {
      setLastError("Cannot upload files while an audit is queued or running.");
      event.target.value = "";
      return;
    }

    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (!selectedFiles.length) {
      return;
    }

    setIsBusy(true);
    setLastError(null);
    try {
      const activeWorkingCopyId = await ensureWorkingCopy();
      const uploadedPaths: string[] = [];

      for (const file of selectedFiles) {
        const uploadPath = normalizePath(file.webkitRelativePath || file.name);
        if (!uploadPath || uploadPath.includes("..")) {
          throw new Error(`Invalid file path: ${file.name}`);
        }

        const content = await file.text();
        const response = await fetch(
          `/api/projects/${projectId}/working-copies/${activeWorkingCopyId}/file`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              path: uploadPath,
              content,
            }),
          },
        );
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? `Failed to upload ${uploadPath}`);
        }

        uploadedPaths.push(uploadPath);
        setFileCache((current) => ({
          ...current,
          [uploadPath]: {
            content,
            language: detectLanguageFromPath(uploadPath),
          },
        }));
      }

      if (uploadedPaths.length) {
        setIsEditable(true);
        setTree((current) =>
          buildTreeFromPaths([
            ...new Set([...treeFiles(current), ...uploadedPaths]),
          ]),
        );
        openFileInEditor(uploadedPaths[0]!);
      }
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsBusy(false);
    }
  }

  const explorerActions: ExplorerActionConfig[] = [
    {
      id: "new-file",
      dropdownLabel: "New file",
      contextLabel: "New File",
      icon: FilePlus2,
      onDropdownSelect: () => {
        startInlineNewFile();
      },
      onContextSelect: () => {
        startInlineNewFile(contextMenuParentPath);
      },
    },
    {
      id: "upload-files",
      dropdownLabel: "Upload files",
      contextLabel: "Upload Files",
      icon: Upload,
      onDropdownSelect: openUploadPicker,
      onContextSelect: openUploadPicker,
    },
    {
      id: "refresh-explorer",
      dropdownLabel: "Refresh explorer",
      contextLabel: "Refresh Explorer",
      icon: RefreshCcw,
      onDropdownSelect: refreshWorkbenchData,
      onContextSelect: refreshWorkbenchData,
    },
  ];

  const railToggles: RailToggleConfig[] = [
    {
      id: "explorer",
      active: isExplorerVisible,
      icon: FolderTree,
      ariaLabel: "Toggle explorer",
      title: "Toggle explorer (Ctrl/Cmd+B)",
      onClick: () => {
        setIsExplorerVisible((current) => !current);
      },
    },
    {
      id: "findings",
      active: isFindingsVisible,
      icon: Shield,
      ariaLabel: "Toggle findings panel",
      onClick: () => {
        setIsFindingsVisible((current) => !current);
      },
    },
    {
      id: "bottom-panel",
      active: isBottomPanelVisible,
      icon: TerminalSquare,
      ariaLabel: "Toggle bottom panel",
      title: "Toggle panel (Ctrl/Cmd+J)",
      onClick: () => {
        setIsBottomPanelVisible((current) => !current);
      },
    },
  ];

  const modelSelectors = [
    {
      id: "primary-model",
      label: "Primary model",
      value: primaryModelId,
      keyPrefix: "toolbar-primary",
      onValueChange: setPrimaryModelId,
    },
    {
      id: "fallback-model",
      label: "Fallback model",
      value: fallbackModelId,
      keyPrefix: "toolbar-fallback",
      onValueChange: setFallbackModelId,
    },
  ] as const;

  return (
    <TooltipProvider delayDuration={150}>
      <Input
        id={uploadInputId}
        type="file"
        multiple
        className="hidden"
        accept=".tolk,.fc,.func,.tact,.fift,.fif,.tlb,.ts,.js,.json,.md,.yaml,.yml,.xml,.lock"
        onChange={uploadFilesToWorkingCopy}
      />

      <div className="bg-background text-foreground flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border">
        <div
          className={cn(
            "grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden",
            workbenchGridClassName,
          )}
        >
          <aside className="bg-muted/30 hidden min-h-0 flex-col items-center gap-3 border-r border-border px-2 py-3 lg:flex">
            {railToggles.map((toggle) => (
              <RailToggleButton
                key={toggle.id}
                active={toggle.active}
                icon={toggle.icon}
                ariaLabel={toggle.ariaLabel}
                title={toggle.title}
                onClick={toggle.onClick}
              />
            ))}
          </aside>

          {isExplorerVisible ? (
            <ContextMenu
              onOpenChange={(open) => {
                if (!open) {
                  setContextMenuTargetNode(null);
                }
              }}
            >
              <ContextMenuTrigger asChild>
                <aside
                  className="bg-muted/30 flex min-h-0 flex-col overflow-hidden border-b border-border p-3 lg:border-r lg:border-b-0"
                  onContextMenuCapture={() => {
                    setContextMenuTargetNode(null);
                  }}
                >
                  <div className="mb-2 flex items-center gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="size-6"
                        >
                          <MoreHorizontal className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-56">
                        <DropdownMenuLabel>Project</DropdownMenuLabel>
                        {explorerActions.map((action) => {
                          const Icon = action.icon;
                          const isWriteExplorerAction =
                            action.id === "new-file" ||
                            action.id === "upload-files";
                          const actionDisabled =
                            isWriteExplorerAction &&
                            (isAuditWriteLocked || isBusy);
                          return (
                            <DropdownMenuItem
                              key={`dropdown-${action.id}`}
                              disabled={actionDisabled}
                              onClick={action.onDropdownSelect}
                            >
                              <Icon className="size-3.5" />
                              {action.dropdownLabel}
                            </DropdownMenuItem>
                          );
                        })}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            router.push("/dashboard");
                          }}
                        >
                          Back to dashboard
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <div className="truncate text-xs font-semibold">
                      {projectName}
                    </div>
                  </div>

                  <Input
                    ref={explorerFilterInputRef}
                    value={explorerQuery}
                    onChange={(event) => setExplorerQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const targetPath = filteredFilePaths[0];
                        if (targetPath) {
                          openFileInEditor(targetPath);
                        }
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setExplorerQuery("");
                        event.currentTarget.blur();
                      }
                    }}
                    className="mb-2 h-7 text-xs"
                    placeholder="Filter files (Ctrl/Cmd+P)"
                  />

                  <ScrollArea className="min-h-0 flex-1 pr-1">
                    <div className="pb-1">
                      {filteredTree.length || isInlineNewFile ? (
                        <TreeView
                          nodes={filteredTree}
                          selectedPath={selectedPath}
                          onSelect={openFileInEditor}
                          expandedDirectories={treeViewExpandedDirectories}
                          onToggleDirectory={toggleDirectory}
                          onContextNode={setContextMenuTargetNode}
                          inlineNewFileDraft={
                            isInlineNewFile
                              ? {
                                  parentPath: inlineNewFileParentPath,
                                  value: inlineNewFileName,
                                  isBusy,
                                  rowRef: inlineNewFileRowRef,
                                  inputRef: newFileInputRef,
                                  onChange: setInlineNewFileName,
                                  onSubmit: submitInlineNewFile,
                                  onCancel: cancelInlineNewFile,
                                }
                              : null
                          }
                        />
                      ) : (
                        <p className="text-muted-foreground px-1 text-xs">
                          No files match your filter.
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </aside>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuLabel>Explorer Actions</ContextMenuLabel>
                <ContextMenuSeparator />
                {explorerActions.map((action) => {
                  const Icon = action.icon;
                  const isWriteExplorerAction =
                    action.id === "new-file" || action.id === "upload-files";
                  const actionDisabled =
                    isWriteExplorerAction && (isAuditWriteLocked || isBusy);
                  return (
                    <ContextMenuItem
                      key={`context-${action.id}`}
                      disabled={actionDisabled}
                      onSelect={() => {
                        action.onContextSelect();
                      }}
                    >
                      <Icon className="size-3.5" />
                      {action.contextLabel}
                    </ContextMenuItem>
                  );
                })}
              </ContextMenuContent>
            </ContextMenu>
          ) : null}

          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="bg-muted/25 border-b border-border">
              <div className="flex h-10 min-w-0 items-stretch">
                <div className="min-w-0 flex-1">
                  {openTabs.length ? (
                    <ScrollArea className="h-full w-full">
                      <div className="flex h-10 w-max items-stretch">
                        {openTabs.map((path) => {
                          const isActive = selectedPath === path;
                          return (
                            <div
                              key={path}
                              className={cn(
                                "group flex items-center border-r border-border",
                                isActive
                                  ? "bg-card text-foreground"
                                  : "bg-muted/20 text-muted-foreground",
                              )}
                            >
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => openFileInEditor(path)}
                                className={cn(
                                  "h-10 min-w-[150px] max-w-[240px] justify-start rounded-none px-2.5 text-xs",
                                  isActive
                                    ? "text-foreground hover:bg-transparent"
                                    : "hover:bg-accent/40",
                                )}
                              >
                                <FileCode2 className="size-3" />
                                <span className="truncate">
                                  {getFileName(path)}
                                </span>
                                {dirtyPathSet.has(path) ? (
                                  <span className="bg-primary ml-1 inline-block size-1.5 rounded-full" />
                                ) : null}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className={cn(
                                  "mr-0.5 size-6 rounded-sm opacity-0 transition-opacity group-hover:opacity-100",
                                  isActive ? "opacity-100" : "",
                                )}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  closeOpenTab(path);
                                }}
                                aria-label={`Close ${getFileName(path)}`}
                              >
                                <X className="size-3.5" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                  ) : (
                    <div className="text-muted-foreground flex h-full items-center px-3 text-xs">
                      Open a file to start editing.
                    </div>
                  )}
                </div>

                <WorkbenchTopToolbar
                  isAuditWriteLocked={isAuditWriteLocked}
                  isBusy={isBusy}
                  isEditable={isEditable}
                  revisionId={revisionId}
                  selectedPath={selectedPath}
                  isSelectedPathDirty={
                    selectedPath ? dirtyPathSet.has(selectedPath) : false
                  }
                  onToggleEditMode={() => {
                    void toggleEditMode();
                  }}
                  onSaveFile={() => {
                    void saveCurrentFile();
                  }}
                  auditProfile={auditProfile}
                  toProfileLabel={toProfileLabel}
                  onRunAudit={runAudit}
                  auditId={auditId}
                  canExportFinalPdf={
                    Boolean(auditId) &&
                    !isBusy &&
                    (activeAuditHistoryItem
                      ? canExportAuditPdf(
                          activeAuditHistoryItem.status,
                          resolveAuditPdfStatus(activeAuditHistoryItem),
                        )
                      : auditStatus === "completed")
                  }
                  onExportFinalPdf={() => {
                    if (!auditId) {
                      return;
                    }
                    void exportPdfForAudit(auditId);
                  }}
                  onRefreshWorkbench={refreshWorkbenchData}
                  isBottomPanelVisible={isBottomPanelVisible}
                  onToggleBottomPanel={() => {
                    setIsBottomPanelVisible((current) => !current);
                  }}
                  auditStatusLabel={auditStatusLabel}
                  auditStatus={auditStatus}
                  isAuditInProgress={isAuditInProgress}
                  dirtyPathCount={dirtyPaths.length}
                  onBackToDashboard={() => {
                    router.push("/dashboard");
                  }}
                  modelSelectors={modelSelectors}
                  modelAllowlist={normalizedModelAllowlist}
                  onAuditProfileChange={setAuditProfile}
                  lspStatus={lspStatus}
                  jobState={jobState}
                  shortId={shortId}
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {selectedPath ? (
                <MonacoEditor
                  path={`file:///workspace/${selectedPath}`}
                  value={currentFile?.content ?? ""}
                  language={currentMonacoLanguage}
                  theme={monacoTheme}
                  options={{
                    readOnly: !isEditable || isAuditWriteLocked,
                    minimap: { enabled: true },
                    fontSize: 13,
                    lineNumbers: "on",
                    automaticLayout: true,
                  }}
                  onMount={onEditorMount}
                  onChange={(value) => {
                    if (!selectedPath || !isEditable || isAuditWriteLocked) {
                      return;
                    }

                    setFileCache((current) => ({
                      ...current,
                      [selectedPath]: {
                        content: value ?? "",
                        language: current[selectedPath]?.language ?? "unknown",
                      },
                    }));
                    setDirtyPaths((current) =>
                      current.includes(selectedPath)
                        ? current
                        : [...current, selectedPath],
                    );
                  }}
                />
              ) : (
                <div className="text-muted-foreground grid h-full place-items-center text-sm">
                  Open a file from the explorer or create one from the context
                  menu.
                </div>
              )}
            </div>

            {isBottomPanelVisible ? (
              <div className="bg-card/70 border-t border-border">
                <div className="flex h-8 items-center gap-1 border-b border-border px-2 text-[11px]">
                  {bottomPanelTabConfig.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <Button
                        key={tab.id}
                        type="button"
                        size="sm"
                        variant="ghost"
                        className={cn(
                          "h-6 gap-1 px-2 text-[11px]",
                          bottomPanelTab === tab.id ? "bg-accent/30" : "",
                        )}
                        onClick={() => setBottomPanelTab(tab.id)}
                      >
                        <Icon className="size-3.5" />
                        {tab.label}
                      </Button>
                    );
                  })}
                  <div className="text-muted-foreground ml-auto truncate">
                    {activityMessage ?? "No active task."}
                  </div>
                </div>

                <div className="h-56">
                  {bottomPanelTab === "audit-log" ? (
                    <ScrollArea className="h-full px-2 py-2">
                      <WorkbenchExecutionTracker
                        visible={shouldShowExecutionTracker}
                        statusLabel={toAuditPipelineStatusLabel(executionTrackerStatus)}
                        statusClassName={auditStatusBadgeClass(executionTrackerStatus)}
                        profileLabel={executionTrackerProfileLabel}
                        resolvedStages={auditPipelineResolvedStages}
                        totalStages={auditPipelineTotalStages}
                        stagePercent={auditPipelinePercent}
                        stageFailed={executionTrackerStatus === "failed"}
                        stages={executionTrackerStageRows}
                        stageStatusClass={auditPipelineStageStatusClass}
                        stageStatusLabel={toAuditPipelineStageStatusLabel}
                        verifyPhaseLabel={verifyProgressPhaseLabel(verifyProgress.phase)}
                        verifyResolvedSteps={verifyProgressResolvedSteps}
                        verifyTotalSteps={verifyProgressTotalSteps}
                        verifyPercent={verifyProgressPercent}
                        verifyFailed={executionTrackerVerifyFailed}
                        activeLabel={executionTrackerActiveLabel}
                        verifySteps={executionTrackerVerifyRows}
                        verifyStepStatusClass={verifyStepStatusClass}
                      />

                      {activityFeed.length ? (
                        <div className="space-y-1.5">
                          {activityFeed.map((entry) => (
                            <div
                              key={entry.id}
                              className="flex items-start gap-2 text-[11px]"
                            >
                              <span className="text-muted-foreground w-16 shrink-0">
                                {new Date(entry.createdAt).toLocaleTimeString()}
                              </span>
                              <span
                                className={cn(
                                  "w-10 shrink-0 uppercase",
                                  workbenchLogLevelClass(entry.level),
                                )}
                              >
                                {entry.level}
                              </span>
                              <span className="text-foreground break-words">
                                {entry.message}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-muted-foreground text-xs">
                          No activity yet.
                        </div>
                      )}
                    </ScrollArea>
                  ) : (
                    <ScrollArea className="h-full px-2 py-2">
                      {problemItems.length ? (
                        <div className="space-y-2">
                          {problemItems.map((item) => (
                            <div
                              key={item}
                              className="text-destructive text-xs"
                            >
                              {item}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-muted-foreground text-xs">
                          No problems detected in this session.
                        </div>
                      )}
                    </ScrollArea>
                  )}
                </div>
              </div>
            ) : null}
          </section>

          {isFindingsVisible ? (
            <aside className="bg-muted/15 min-h-0 overflow-hidden border-t border-border lg:border-l lg:border-t-0">
              <Tabs
                value={rightPanelTab}
                onValueChange={handleRightPanelTabChange}
                className="h-full min-h-0 min-w-0 gap-0"
              >
                <div className="bg-card/40 border-b border-border px-3 pb-3 pt-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-muted-foreground text-[10px] uppercase tracking-[0.12em]">
                        Review Panel
                      </p>
                      <h3 className="text-foreground truncate text-sm font-semibold">
                        Audit Workspace
                      </h3>
                      <p className="text-muted-foreground truncate text-[11px]">
                        {activeAuditHistoryItem
                          ? `Selected audit ${shortId(activeAuditHistoryItem.id)}`
                          : "No audit selected"}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-5 border px-1.5 text-[10px] font-medium",
                        auditStatusBadgeClass(auditStatus),
                      )}
                    >
                      {toAuditStatusLabel(auditStatus)}
                    </Badge>
                  </div>

                  <TabsList className="mt-3 grid h-8 w-full grid-cols-2">
                    {rightPanelTabConfig.map((tab) => {
                      const Icon = tab.icon;
                      const count =
                        tab.id === "findings" ? findings.length : auditHistory.length;

                      return (
                        <TabsTrigger
                          key={tab.id}
                          value={tab.id}
                          className="h-6 gap-1.5 px-2 text-[11px]"
                        >
                          <Icon className="size-3.5" />
                          <span>{tab.label}</span>
                          <span className="bg-muted text-muted-foreground ml-0.5 rounded-full px-1.5 text-[10px] leading-4">
                            {count}
                          </span>
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </div>

                <TabsContent
                  value="findings"
                  className="mt-0 min-h-0 min-w-0 flex-1 overflow-hidden"
                >
                  <WorkbenchFindingsPanel
                    findingsQuery={findingsQuery}
                    findingsSeverityFilter={findingsSeverityFilter}
                    findingFilterOptions={findingFilterOptions}
                    findings={findings}
                    filteredFindings={filteredFindings}
                    onFindingsQueryChange={setFindingsQuery}
                    onFindingsSeverityFilterChange={(value) => {
                      if (isFindingSeverityFilter(value)) {
                        setFindingsSeverityFilter(value);
                      }
                    }}
                    onClearFindingsFilters={() => {
                      setFindingsQuery("");
                      setFindingsSeverityFilter("all");
                    }}
                    onRevealFinding={(item) => {
                      revealFindingInEditor(item as AuditFindingInstance);
                    }}
                    severityBadgeClass={severityBadgeClass}
                    formatSeverityLabel={formatSeverityLabel}
                    lastError={lastError}
                  />
                </TabsContent>

                <TabsContent
                  value="audit-history"
                  className="mt-0 min-h-0 min-w-0 flex-1 overflow-hidden"
                >
                  <div className="h-full min-w-0 overflow-y-auto overflow-x-hidden px-3 py-3">
                    <div className="min-w-0 space-y-3 pb-3">
                      <div className="bg-card min-w-0 overflow-hidden rounded-lg border border-border p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <h4 className="text-foreground text-xs font-semibold">
                            Compare Completed Audits
                          </h4>
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                            {completedAuditHistory.length} completed
                          </Badge>
                        </div>
                        {completedAuditHistory.length < 2 ? (
                          <p className="text-muted-foreground text-xs">
                            Run at least two completed audits to compare revisions.
                          </p>
                        ) : (
                          <div className="space-y-2.5">
                            <div className="grid grid-cols-1 gap-2">
                              <label className="text-foreground min-w-0 text-[11px]">
                                From (older)
                                <Select
                                  value={fromCompareAuditId}
                                  onValueChange={setFromCompareAuditId}
                                >
                                  <SelectTrigger className="mt-1 h-8 w-full min-w-0 text-[11px]">
                                    <SelectValue placeholder="Select older audit" />
                                  </SelectTrigger>
                                  <SelectContent
                                    position="popper"
                                    align="start"
                                    className="w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)]"
                                  >
                                    {completedAuditHistory.map((item) => (
                                      <SelectItem key={`from-${item.id}`} value={item.id}>
                                        {shortId(item.id)} · rev {shortId(item.revisionId)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </label>
                              <label className="text-foreground min-w-0 text-[11px]">
                                To (newer)
                                <Select
                                  value={toCompareAuditId}
                                  onValueChange={setToCompareAuditId}
                                >
                                  <SelectTrigger className="mt-1 h-8 w-full min-w-0 text-[11px]">
                                    <SelectValue placeholder="Select newer audit" />
                                  </SelectTrigger>
                                  <SelectContent
                                    position="popper"
                                    align="start"
                                    className="w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)]"
                                  >
                                    {completedAuditHistory.map((item) => (
                                      <SelectItem key={`to-${item.id}`} value={item.id}>
                                        {shortId(item.id)} · rev {shortId(item.revisionId)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </label>
                            </div>

                            <Button
                              type="button"
                              size="sm"
                              className="h-8 w-full text-xs"
                              disabled={isAuditCompareActionDisabled}
                              onClick={() => {
                                void runAuditComparison();
                              }}
                            >
                              {isAuditCompareLoading ? "Comparing..." : "Compare Audits"}
                            </Button>
                          </div>
                        )}

                        {auditCompareResult ? (
                          <div className="mt-3 min-w-0 space-y-2 text-xs">
                            <div className="text-muted-foreground break-words text-[11px]">
                              {shortId(auditCompareResult.fromAudit.id)} (
                              {new Date(
                                auditCompareResult.fromAudit.createdAt,
                              ).toLocaleString()}
                              ) {" -> "} {shortId(auditCompareResult.toAudit.id)} (
                              {new Date(
                                auditCompareResult.toAudit.createdAt,
                              ).toLocaleString()}
                              )
                            </div>

                            <div className="grid grid-cols-2 gap-1.5">
                              <div className="bg-muted/70 min-w-0 rounded-md px-2 py-1.5">
                                <div className="text-muted-foreground truncate text-[10px] uppercase tracking-wide">
                                  New
                                </div>
                                <div className="text-sm font-semibold">
                                  {auditCompareResult.summary.findings.newCount}
                                </div>
                              </div>
                              <div className="bg-muted/70 min-w-0 rounded-md px-2 py-1.5">
                                <div className="text-muted-foreground truncate text-[10px] uppercase tracking-wide">
                                  Resolved
                                </div>
                                <div className="text-sm font-semibold">
                                  {auditCompareResult.summary.findings.resolvedCount}
                                </div>
                              </div>
                              <div className="bg-muted/70 min-w-0 rounded-md px-2 py-1.5">
                                <div className="text-muted-foreground truncate text-[10px] uppercase tracking-wide">
                                  Persisting
                                </div>
                                <div className="text-sm font-semibold">
                                  {auditCompareResult.summary.findings.persistingCount}
                                </div>
                              </div>
                              <div className="bg-muted/70 min-w-0 rounded-md px-2 py-1.5">
                                <div className="text-muted-foreground truncate text-[10px] uppercase tracking-wide">
                                  Severity Delta
                                </div>
                                <div className="text-sm font-semibold">
                                  {
                                    auditCompareResult.summary.findings
                                      .severityChangedCount
                                  }
                                </div>
                              </div>
                            </div>

                            <div className="space-y-1 text-[11px]">
                              <div className="text-foreground font-medium">
                                Newly detected
                              </div>
                              {auditCompareResult.findings.newlyDetected.length ? (
                                auditCompareResult.findings.newlyDetected
                                  .slice(0, 6)
                                  .map((item) => (
                                    <div
                                      key={`new-${item.findingId}`}
                                      className="text-muted-foreground break-words"
                                    >
                                      {item.severity} · {item.title} · {item.filePath}:
                                      {item.startLine}
                                    </div>
                                  ))
                              ) : (
                                <div className="text-muted-foreground">None</div>
                              )}
                            </div>

                            <div className="space-y-1 text-[11px]">
                              <div className="text-foreground font-medium">
                                Resolved
                              </div>
                              {auditCompareResult.findings.resolved.length ? (
                                auditCompareResult.findings.resolved
                                  .slice(0, 6)
                                  .map((item) => (
                                    <div
                                      key={`resolved-${item.findingId}`}
                                      className="text-muted-foreground break-words"
                                    >
                                      {item.severity} · {item.title} · {item.filePath}:
                                      {item.startLine}
                                    </div>
                                  ))
                              ) : (
                                <div className="text-muted-foreground">None</div>
                              )}
                            </div>

                            <div className="space-y-1 text-[11px]">
                              <div className="text-foreground font-medium">
                                Persisting
                              </div>
                              {auditCompareResult.findings.persisting.length ? (
                                auditCompareResult.findings.persisting
                                  .slice(0, 6)
                                  .map((item) => (
                                    <div
                                      key={`persisting-${item.findingId}`}
                                      className="text-muted-foreground break-words"
                                    >
                                      {item.fromSeverity}
                                      {" -> "}
                                      {item.toSeverity}
                                      {" · "}
                                      {item.title}
                                      {" · "}
                                      {item.filePath}:{item.startLine}
                                    </div>
                                  ))
                              ) : (
                                <div className="text-muted-foreground">None</div>
                              )}
                            </div>

                            <div className="space-y-1 text-[11px]">
                              <div className="text-foreground font-medium">Files</div>
                              <div className="text-muted-foreground break-words">
                                Added {auditCompareResult.summary.files.addedCount} ·
                                Removed {auditCompareResult.summary.files.removedCount} ·
                                Unchanged{" "}
                                {auditCompareResult.summary.files.unchangedCount}
                              </div>
                              {auditCompareResult.files.added.length ? (
                                <div className="text-muted-foreground break-words">
                                  Added:{" "}
                                  {auditCompareResult.files.added
                                    .slice(0, 5)
                                    .join(", ")}
                                </div>
                              ) : null}
                              {auditCompareResult.files.removed.length ? (
                                <div className="text-muted-foreground break-words">
                                  Removed:{" "}
                                  {auditCompareResult.files.removed
                                    .slice(0, 5)
                                    .join(", ")}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-foreground text-xs font-semibold">
                            Audit Runs
                          </h4>
                          {isAuditHistoryLoading ? (
                            <span className="text-muted-foreground text-[11px]">
                              Refreshing...
                            </span>
                          ) : null}
                        </div>
                        {isAuditHistoryLoading && auditHistory.length === 0 ? (
                          <div className="text-muted-foreground text-xs">
                            Loading audit history...
                          </div>
                        ) : auditHistory.length === 0 ? (
                          <div className="text-muted-foreground text-xs">
                            No audits yet for this project.
                          </div>
                        ) : (
                          <WorkbenchAuditHistoryList
                            items={auditHistory}
                            selectedAuditId={auditId}
                            isBusy={isBusy}
                            shortId={shortId}
                            toAuditStatusLabel={toAuditStatusLabel}
                            auditStatusBadgeClass={auditStatusBadgeClass}
                            toPdfStatusLabel={toPdfStatusLabel}
                            pdfStatusBadgeClass={pdfStatusBadgeClass}
                            toProfileLabel={toProfileLabel}
                            getPdfStatus={resolveAuditPdfStatus}
                            canExportPdf={canExportAuditPdf}
                            onViewAudit={viewAuditFromHistory}
                            onExportPdf={(targetAuditId) => {
                              void exportPdfForAudit(targetAuditId);
                            }}
                          />
                        )}
                      </div>
                      {lastError ? (
                        <p className="text-destructive text-xs">{lastError}</p>
                      ) : null}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </aside>
          ) : null}
        </div>

        <footer className="bg-card/70 flex h-7 items-center gap-3 border-t border-border px-2 text-[11px]">
          <span className="text-foreground">
            {isEditable ? "Editing" : "Read-only"}
          </span>
          <span className="text-muted-foreground">
            {selectedPath ? getFileName(selectedPath) : "No file selected"}
          </span>
          <span className="text-muted-foreground">
            Ln {cursorPosition.line}, Col {cursorPosition.column}
          </span>
          <span className="text-muted-foreground">
            {currentFile?.language ?? "plaintext"}
          </span>
          <span className="text-muted-foreground">
            audit {auditStatusLabel}
          </span>
          <span className="text-muted-foreground">LSP {lspStatus}</span>
          <span className="text-muted-foreground">tabs {openTabs.length}</span>
          <span className="text-muted-foreground ml-auto">
            {dirtyPaths.length
              ? `${dirtyPaths.length} unsaved file(s)`
              : "All changes saved or staged"}
          </span>
        </footer>
      </div>
    </TooltipProvider>
  );
}

