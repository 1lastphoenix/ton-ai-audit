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
  bottomPanelTabConfig,
  rightPanelTabConfig,
} from "@/components/workbench/ton-workbench.constants";
import {
  auditPipelineStageStatusClass,
  auditStatusBadgeClass,
  buildLspWebSocketUrls,
  canExportAuditPdf,
  collectDirectoryPaths,
  formatSeverityLabel,
  getFileName,
  getParentDirectories,
  isFindingSeverityFilter,
  normalizeModelAllowlist,
  pdfStatusBadgeClass,
  resolveAuditPdfStatus,
  resolveMonacoLanguage,
  severityBadgeClass,
  shortId,
  summarizeVerifyProgress,
  toAuditPipelineStageStatusLabel,
  toAuditPipelineStatusLabel,
  toAuditStatusLabel,
  toPdfStatusLabel,
  toProfileLabel,
  treeFiles,
  verifyProgressPhaseLabel,
  verifyStepStatusClass,
  workbenchLogLevelClass,
} from "@/components/workbench/ton-workbench.utils";
import { MonacoEditor } from "@/components/workbench/workbench-monaco-editor";
import { RailToggleButton } from "@/components/workbench/workbench-rail-toggle-button";
import { TreeView } from "@/components/workbench/workbench-tree-view";
import { useWorkbenchFiles } from "@/components/workbench/use-workbench-files";
import { useWorkbenchAudit } from "@/components/workbench/use-workbench-audit";
import { useWorkbenchEvents } from "@/components/workbench/use-workbench-events";
import type {
  AuditFindingInstance,
  AuditPipelineStatus,
  ExplorerActionConfig,
  RailToggleConfig,
  RightPanelTab,
  TonWorkbenchProps,
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
  const [lspStatus, setLspStatus] = useState<TonLspStatus>("idle");
  const [lspErrorDetail, setLspErrorDetail] = useState<string | null>(null);
  const [activityMessage, setActivityMessage] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("findings");
  const [bottomPanelTab, setBottomPanelTab] = useState<
    "audit-log" | "problems"
  >("audit-log");
  const [activityFeed, setActivityFeed] = useState<WorkbenchLogEntry[]>([]);
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
  const [isEditModeBusy, setIsEditModeBusy] = useState(false);

  const uploadInputId = useId();
  const modelStorageKey = `ton-audit:model-selection:${projectId}`;

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

  const {
    revisionId,
    setRevisionId,
    workingCopyId,
    setWorkingCopyId,
    isEditable,
    setIsEditable,
    isBusy: isFilesBusy,
    tree,
    selectedPath,
    openTabs,
    expandedDirectories,
    dirtyPaths,
    setDirtyPaths,
    fileCache,
    setFileCache,
    isInlineNewFile,
    inlineNewFileName,
    setInlineNewFileName,
    inlineNewFileParentPath,
    inlineNewFileRowRef,
    newFileInputRef,
    openFileInEditor,
    toggleDirectory,
    closeOpenTab,
    ensureWorkingCopy,
    saveFilePath,
    saveCurrentFile: saveCurrentFileInternal,
    startInlineNewFile: startInlineNewFileInternal,
    cancelInlineNewFile,
    submitInlineNewFile: submitInlineNewFileInternal,
    uploadFilesToWorkingCopy: uploadFilesToWorkingCopyInternal,
    refreshFiles,
  } = useWorkbenchFiles({
    projectId,
    initialRevisionId,
    initialWorkingCopyId,
    onError: setLastError,
    onClearError: () => setLastError(null),
    onActivity: setActivityMessage,
    onLog: pushWorkbenchLog,
  });

  const {
    auditId,
    isBusy: isAuditBusy,
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
    runAudit: runAuditInternal,
    exportPdfForAudit,
  } = useWorkbenchAudit({
    projectId,
    initialAuditId,
    modelStorageKey,
    normalizedModelAllowlist,
    workingCopyId,
    setRevisionId: (value) => setRevisionId(value),
    setWorkingCopyId,
    isEditable,
    setIsEditable,
    dirtyPaths,
    setDirtyPaths,
    selectedPath,
    ensureWorkingCopy,
    saveFilePath,
    onError: setLastError,
    onClearError: () => setLastError(null),
    onActivity: setActivityMessage,
    onLog: pushWorkbenchLog,
    onViewAuditFromHistory: () => {
      setRightPanelTab("findings");
    },
  });

  const { jobState, setJobState, registerJobIds } = useWorkbenchEvents({
    projectId,
    auditId,
    auditStatus,
    isAuditInProgress,
    setAuditStatus,
    setVerifyProgress,
    setAuditPipeline,
    loadAudit,
    loadAuditHistory,
    onActivity: setActivityMessage,
    onLog: pushWorkbenchLog,
  });

  const isBusy = isFilesBusy || isAuditBusy || isEditModeBusy;
  const isAuditWriteLocked = isAuditInProgress || jobState === "queuing";
  const auditStatusLabel = toAuditStatusLabel(auditStatus);

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

  const handleRightPanelTabChange = useCallback((nextTab: string) => {
    if (nextTab === "findings" || nextTab === "audit-history") {
      setRightPanelTab(nextTab);
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

  const refreshWorkbenchData = useCallback(() => {
    void (async () => {
      await refreshFiles();
      try {
        if (auditId) {
          await loadAudit(auditId);
        }
        await loadAuditHistory();
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Refresh failed");
      }
    })();
  }, [auditId, loadAudit, loadAuditHistory, refreshFiles]);

  const saveCurrentFile = useCallback(
    async (options?: { withoutBusy?: boolean }) => {
      if (isAuditWriteLocked || !isEditable) {
        return false;
      }

      return saveCurrentFileInternal(options);
    },
    [isAuditWriteLocked, isEditable, saveCurrentFileInternal],
  );

  async function enableEditing() {
    if (isAuditWriteLocked) {
      setLastError("Editing is disabled while an audit is queued or running.");
      pushWorkbenchLog(
        "warn",
        "Edit mode blocked while audit is queued/running.",
      );
      return;
    }

    setIsEditModeBusy(true);
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
      setIsEditModeBusy(false);
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

  async function runAudit() {
    if (isAuditWriteLocked) {
      setLastError("Audit is already queued or running for this project.");
      return;
    }

    setJobState("queuing");
    const queued = await runAuditInternal(isAuditWriteLocked);
    if (!queued) {
      setJobState("idle");
      return;
    }

    registerJobIds([
      queued.verifyJobId,
      queued.auditJobId,
      queued.lifecycleJobId,
    ]);
    setJobState(queued.verifyJobId);
  }

  function startInlineNewFile(parentPath?: string | null) {
    if (isAuditWriteLocked) {
      setLastError("Cannot create files while an audit is queued or running.");
      return;
    }

    setExplorerQuery("");
    startInlineNewFileInternal(parentPath);
  }

  function submitInlineNewFile() {
    if (isAuditWriteLocked) {
      setLastError("Cannot create files while an audit is queued or running.");
      return;
    }

    submitInlineNewFileInternal();
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

    await uploadFilesToWorkingCopyInternal(event);
  }

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

  useEffect(() => {
    pushWorkbenchLog("info", `Workspace opened for project "${projectName}".`);
  }, [projectName, pushWorkbenchLog]);

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
    mediaQuery.addEventListener("change", handleChange);

    const observer = new MutationObserver(() => {
      computePrefersDark();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    setCursorPosition({ line: 1, column: 1 });
  }, [selectedPath]);

  useEffect(() => {
    return () => {
      if (lspClientRef.current) {
        void lspClientRef.current.dispose();
        lspClientRef.current = null;
      }
    };
  }, []);

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

