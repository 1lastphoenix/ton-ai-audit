"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent
} from "react";
import type { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useTheme } from "next-themes";
import {
  CircleAlert,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileDown,
  FilePlus2,
  Folder,
  FolderTree,
  FolderOpen,
  Lock,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCcw,
  Save,
  Shield,
  TerminalSquare,
  Upload,
  X
} from "lucide-react";

import { detectLanguageFromPath, normalizePath, type Language } from "@ton-audit/shared";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  registerTonLanguages,
  startTonLspClient,
  type TonLspStatus
} from "@/lib/editor/ton-lsp-client";
import { cn } from "@/lib/utils";
import {
  filterWorkbenchTree,
  resolveMonacoTheme,
  type WorkbenchTreeNode
} from "@/components/workbench/workbench-ui-utils";

type TreeNode = WorkbenchTreeNode;

type FindingPayload = {
  title: string;
  severity: string;
  summary: string;
  remediation: string;
  evidence: {
    filePath: string;
    startLine: number;
    endLine: number;
    snippet: string;
  };
};

type AuditFindingInstance = {
  id: string;
  payloadJson: FindingPayload;
  severity: string;
};

type WorkbenchLogLevel = "info" | "warn" | "error";
type WorkbenchLogEntry = {
  id: string;
  createdAt: string;
  level: WorkbenchLogLevel;
  message: string;
};

type BackendJobEvent = {
  id: string;
  projectId: string | null;
  queue: string;
  jobId: string;
  event: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type TonWorkbenchProps = {
  projectId: string;
  projectName: string;
  initialRevisionId: string | null;
  initialAuditId: string | null;
  modelAllowlist: string[];
};

const MonacoEditor = dynamic(
  async () => {
    const [monacoReactModule, monacoModule] = await Promise.all([
      import("@monaco-editor/react"),
      import("monaco-editor")
    ]);

    monacoReactModule.loader.config({ monaco: monacoModule });

    return monacoReactModule.default;
  },
  {
    ssr: false,
    loading: () => (
      <div className="text-muted-foreground grid h-full place-items-center text-sm">Loading editor...</div>
    )
  }
);

const languageMap: Record<string, string> = {
  tolk: "tolk",
  func: "func",
  tact: "tact",
  fift: "fift",
  "tl-b": "tl-b",
  unknown: "plaintext"
};

function treeFiles(nodes: TreeNode[]): string[] {
  const files: string[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      files.push(node.path);
      continue;
    }
    files.push(...treeFiles(node.children ?? []));
  }
  return files;
}

function buildTreeFromPaths(paths: string[]): TreeNode[] {
  type MutableNode = {
    name: string;
    path: string;
    type: "file" | "directory";
    children: Map<string, MutableNode>;
  };

  const root = new Map<string, MutableNode>();

  for (const rawPath of paths) {
    const normalizedPath = normalizePath(rawPath);
    if (!normalizedPath) {
      continue;
    }

    const parts = normalizedPath.split("/").filter(Boolean);
    if (!parts.length) {
      continue;
    }

    let currentChildren = root;
    let currentPath = "";

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!;
      const isLeaf = index === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!currentChildren.has(part)) {
        currentChildren.set(part, {
          name: part,
          path: currentPath,
          type: isLeaf ? "file" : "directory",
          children: new Map<string, MutableNode>()
        });
      }

      const node = currentChildren.get(part)!;
      if (!isLeaf) {
        node.type = "directory";
        currentChildren = node.children;
      }
    }
  }

  const toNode = (node: MutableNode): TreeNode => {
    if (node.type === "file") {
      return {
        name: node.name,
        path: node.path,
        type: "file"
      };
    }

    const children = [...node.children.values()]
      .map(toNode)
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "directory" ? -1 : 1;
        }

        return a.name.localeCompare(b.name);
      });

    return {
      name: node.name,
      path: node.path,
      type: "directory",
      children
    };
  };

  return [...root.values()]
    .map(toNode)
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });
}

function severityTone(severity: string) {
  void severity;
  return "text-foreground";
}

function getFileName(filePath: string) {
  const parts = filePath.split("/");
  return parts[parts.length - 1] ?? filePath;
}

function shortId(value: string | null, size = 8) {
  if (!value) {
    return "none";
  }

  return value.slice(0, size);
}

function toAuditStatusLabel(status: string) {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "Idle";
  }
}

function workbenchLogLevelClass(level: WorkbenchLogLevel) {
  switch (level) {
    case "error":
      return "text-destructive";
    case "warn":
      return "text-foreground";
    default:
      return "text-muted-foreground";
  }
}

function collectDirectoryPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];

  for (const node of nodes) {
    if (node.type !== "directory") {
      continue;
    }

    paths.push(node.path);
    paths.push(...collectDirectoryPaths(node.children ?? []));
  }

  return paths;
}

function getParentDirectories(filePath: string): string[] {
  const normalized = normalizePath(filePath);
  if (!normalized) {
    return [];
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return [];
  }

  const directories: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    directories.push(parts.slice(0, index).join("/"));
  }

  return directories;
}

function TreeView(props: {
  nodes: TreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  expandedDirectories: Set<string>;
  onToggleDirectory: (path: string) => void;
  depth?: number;
}) {
  const {
    nodes,
    selectedPath,
    onSelect,
    expandedDirectories = new Set<string>(),
    onToggleDirectory = () => undefined,
    depth = 0
  } = props;

  return (
    <ul className="space-y-0.5 text-xs">
      {nodes.map((node) => {
        if (node.type === "directory") {
          const expanded = expandedDirectories.has(node.path);
          return (
            <li key={node.path}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onToggleDirectory(node.path)}
                className="h-6 w-full justify-start gap-1 rounded px-1 text-left text-xs"
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
              >
                {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                {expanded ? <FolderOpen className="size-3.5" /> : <Folder className="size-3.5" />}
                <span className="truncate">{node.name}</span>
              </Button>
              {expanded ? (
                <TreeView
                  nodes={node.children ?? []}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  expandedDirectories={expandedDirectories}
                  onToggleDirectory={onToggleDirectory}
                  depth={depth + 1}
                />
              ) : null}
            </li>
          );
        }

        return (
          <li key={node.path}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onSelect(node.path)}
              className={cn(
                "h-6 w-full justify-start gap-1 rounded px-1 text-left text-xs",
                selectedPath === node.path
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-accent/60"
              )}
              style={{ paddingLeft: `${depth * 12 + 22}px` }}
            >
              <FileCode2 className="size-3" />
              <span className="truncate">{node.name}</span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export function TonWorkbench(props: TonWorkbenchProps) {
  const { projectId, projectName, initialRevisionId, initialAuditId, modelAllowlist } = props;
  const router = useRouter();
  const { resolvedTheme } = useTheme();

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const lspClientRef = useRef<{ dispose: () => Promise<void> | void } | null>(null);
  const explorerFilterInputRef = useRef<HTMLInputElement | null>(null);
  const [revisionId, setRevisionId] = useState(initialRevisionId);
  const [auditId, setAuditId] = useState(initialAuditId);
  const [workingCopyId, setWorkingCopyId] = useState<string | null>(null);
  const [isEditable, setIsEditable] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [expandedDirectories, setExpandedDirectories] = useState<string[]>([]);
  const [dirtyPaths, setDirtyPaths] = useState<string[]>([]);
  const [fileCache, setFileCache] = useState<Record<string, { content: string; language: Language }>>({});
  const [findings, setFindings] = useState<AuditFindingInstance[]>([]);
  const [primaryModelId, setPrimaryModelId] = useState(modelAllowlist[0] ?? "openai/gpt-5");
  const [fallbackModelId, setFallbackModelId] = useState(
    modelAllowlist[1] ?? modelAllowlist[0] ?? "openai/gpt-5-mini"
  );
  const [jobState, setJobState] = useState<string>("idle");
  const [auditStatus, setAuditStatus] = useState<string>("idle");
  const [lspStatus, setLspStatus] = useState<TonLspStatus>("idle");
  const [activityMessage, setActivityMessage] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [bottomPanelTab, setBottomPanelTab] = useState<"audit-log" | "problems">("audit-log");
  const [activityFeed, setActivityFeed] = useState<WorkbenchLogEntry[]>([]);
  const [activeJobIds, setActiveJobIds] = useState<string[]>([]);
  const [isInlineNewFile, setIsInlineNewFile] = useState(false);
  const [inlineNewFilePath, setInlineNewFilePath] = useState("contracts/new-module.tolk");
  const [explorerQuery, setExplorerQuery] = useState("");
  const [isExplorerVisible, setIsExplorerVisible] = useState(true);
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(true);
  const [isFindingsVisible, setIsFindingsVisible] = useState(true);
  const [prefersDark, setPrefersDark] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const newFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastAuditStatusRef = useRef<string>("idle");
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const lastBackendEventAtRef = useRef<number>(Date.now());
  const staleBackendWarningShownRef = useRef(false);

  const uploadInputId = useId();
  const modelStorageKey = `ton-audit:model-selection:${projectId}`;
  const allFiles = useMemo(() => treeFiles(tree), [tree]);
  const expandedDirectorySet = useMemo(() => new Set(expandedDirectories), [expandedDirectories]);
  const dirtyPathSet = useMemo(() => new Set(dirtyPaths), [dirtyPaths]);
  const currentFile = selectedPath ? fileCache[selectedPath] : null;
  const auditStatusLabel = toAuditStatusLabel(auditStatus);
  const isAuditInProgress = auditStatus === "queued" || auditStatus === "running";
  const filteredTree = useMemo(() => filterWorkbenchTree(tree, explorerQuery), [tree, explorerQuery]);
  const filteredFilePaths = useMemo(() => treeFiles(filteredTree), [filteredTree]);
  const monacoTheme = useMemo(
    () => resolveMonacoTheme({ resolvedTheme, prefersDark }),
    [prefersDark, resolvedTheme]
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
  const problemItems = useMemo(() => {
    const items: string[] = [];
    if (lastError) {
      items.push(lastError);
    }
    if (auditStatus === "failed") {
      items.push("Audit run failed. Open worker logs and retry.");
    }
    return items;
  }, [auditStatus, lastError]);

  const pushWorkbenchLog = useCallback((level: WorkbenchLogLevel, message: string) => {
    const entry: WorkbenchLogEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
      level,
      message
    };

    setActivityFeed((current) => [entry, ...current].slice(0, 150));
  }, []);

  const registerJobIds = useCallback((jobIds: Array<string | null | undefined>) => {
    const normalized = jobIds
      .map((item) => (item ? String(item).trim() : ""))
      .filter(Boolean);

    if (!normalized.length) {
      return;
    }

    setActiveJobIds((current) => [...new Set([...current, ...normalized])].slice(-48));
    lastBackendEventAtRef.current = Date.now();
    staleBackendWarningShownRef.current = false;
  }, []);

  const openFileInEditor = useCallback((path: string) => {
    setSelectedPath(path);
    setOpenTabs((current) => (current.includes(path) ? current : [...current, path]));
    const parents = getParentDirectories(path);
    if (parents.length) {
      setExpandedDirectories((current) => [...new Set([...current, ...parents])]);
    }
  }, []);

  const toggleDirectory = useCallback((path: string) => {
    setExpandedDirectories((current) =>
      current.includes(path) ? current.filter((entry) => entry !== path) : [...current, path]
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
      const response = await fetch(`/api/projects/${projectId}/revisions/${targetRevisionId}/tree`, {
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error("Failed to fetch file tree");
      }
      const payload = (await response.json()) as { tree: TreeNode[] };
      setTree(payload.tree);
      const firstFile = treeFiles(payload.tree)[0] ?? null;
      setSelectedPath((current) => current ?? firstFile);
    },
    [projectId]
  );

  const loadFile = useCallback(
    async (path: string) => {
      if (!revisionId) {
        return;
      }
      if (fileCache[path]) {
        return;
      }

      const search = new URLSearchParams({ path }).toString();
      const response = await fetch(`/api/projects/${projectId}/revisions/${revisionId}/file?${search}`, {
        cache: "no-store"
      });
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
          language: payload.file.language
        }
      }));
    },
    [fileCache, projectId, revisionId]
  );

  const loadAudit = useCallback(
    async (targetAuditId: string) => {
      const response = await fetch(`/api/projects/${projectId}/audits/${targetAuditId}`, {
        cache: "no-store"
      });
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
          pushWorkbenchLog("info", `Audit ${shortId(targetAuditId)} running verification and analysis.`);
        } else if (nextStatus === "completed") {
          pushWorkbenchLog(
            "info",
            `Audit ${shortId(targetAuditId)} completed with ${payload.findings?.length ?? 0} finding(s).`
          );
        } else if (nextStatus === "failed") {
          pushWorkbenchLog("error", `Audit ${shortId(targetAuditId)} failed.`);
        }
        lastAuditStatusRef.current = nextStatus;
      }

      if (nextStatus === "completed") {
        setActivityMessage(`Audit completed: ${payload.findings?.length ?? 0} finding(s).`);
      } else if (nextStatus === "failed") {
        setActivityMessage("Audit failed. Check audit log for details.");
      } else if (nextStatus === "running") {
        setActivityMessage("Audit is running.");
      } else if (nextStatus === "queued") {
        setActivityMessage("Audit is queued and waiting for a worker.");
      }
    },
    [projectId, pushWorkbenchLog]
  );

  useEffect(() => {
    setFileCache({});
    setOpenTabs([]);
    setDirtyPaths([]);
    setSelectedPath(null);
  }, [revisionId]);

  useEffect(() => {
    if (!revisionId) {
      return;
    }

    loadTree(revisionId).catch((error: unknown) => {
      setLastError(error instanceof Error ? error.message : "Unable to load revision tree");
    });
  }, [revisionId, loadTree]);

  useEffect(() => {
    if (!selectedPath) {
      return;
    }

    loadFile(selectedPath).catch((error: unknown) => {
      setLastError(error instanceof Error ? error.message : "Unable to load file");
    });
  }, [selectedPath, loadFile]);

  useEffect(() => {
    if (!auditId) {
      return;
    }

    loadAudit(auditId).catch((error: unknown) => {
      setLastError(error instanceof Error ? error.message : "Unable to load findings");
    });
  }, [auditId, loadAudit]);

  useEffect(() => {
    lastAuditStatusRef.current = "idle";
  }, [auditId]);

  useEffect(() => {
    if (!auditId || !isAuditInProgress) {
      return;
    }

    registerJobIds([
      `verify:${projectId}:${auditId}`,
      `audit:${projectId}:${auditId}`,
      `finding-lifecycle:${projectId}:${auditId}`
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
        `/api/jobs/${encodeURIComponent(jobId)}/events?projectId=${projectId}`
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
          typeof payload.payload?.message === "string" ? payload.payload.message : null;
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
          if (payload.event === "started" || payload.event === "worker-started") {
            setActivityMessage("Verification started.");
          } else if (payload.event === "completed" || payload.event === "worker-completed") {
            setActivityMessage("Verification completed. Waiting for audit stage...");
          } else if (isFailureEvent) {
            setActivityMessage("Verification failed.");
          }
          return;
        }

        if (payload.queue === "audit") {
          if (payload.event === "started" || payload.event === "worker-started") {
            setAuditStatus("running");
            setActivityMessage("Audit analysis is running.");
          } else if (payload.event === "completed" || payload.event === "worker-completed") {
            setAuditStatus("completed");
            setActivityMessage("Audit completed.");
            if (auditId) {
              loadAudit(auditId).catch(() => undefined);
            }
          } else if (isFailureEvent) {
            setAuditStatus("failed");
            setActivityMessage("Audit failed.");
          }
          return;
        }

        if (payload.queue === "finding-lifecycle") {
          if (payload.event === "completed" || payload.event === "worker-completed") {
            setActivityMessage("Finding lifecycle mapping completed.");
            if (auditId) {
              loadAudit(auditId).catch(() => undefined);
            }
          }
          return;
        }

        if (payload.queue === "pdf") {
          if (payload.event === "started" || payload.event === "worker-started") {
            setActivityMessage("PDF export is running.");
          } else if (payload.event === "completed" || payload.event === "worker-completed") {
            setActivityMessage("PDF export completed.");
          } else if (isFailureEvent) {
            setActivityMessage("PDF export failed.");
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
          `Job event stream error for ${jobId}. If this persists, check worker/API health.`
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
  }, [activeJobIds, auditId, loadAudit, projectId, pushWorkbenchLog]);

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
      setActivityMessage("Audit is queued but no backend worker events were received for 30s.");
      pushWorkbenchLog(
        "warn",
        "No backend job events for 30s while audit is queued/running. Worker may be offline."
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

    setOpenTabs((current) => (current.includes(selectedPath) ? current : [...current, selectedPath]));
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
    setDirtyPaths((current) => current.filter((path) => availablePaths.has(path)));
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
    const persisted = window.localStorage.getItem(modelStorageKey);
    if (!persisted) {
      return;
    }

    try {
      const parsed = JSON.parse(persisted) as {
        primaryModelId?: string;
        fallbackModelId?: string;
      };

      if (parsed.primaryModelId && modelAllowlist.includes(parsed.primaryModelId)) {
        setPrimaryModelId(parsed.primaryModelId);
      }
      if (parsed.fallbackModelId && modelAllowlist.includes(parsed.fallbackModelId)) {
        setFallbackModelId(parsed.fallbackModelId);
      }
    } catch {
      window.localStorage.removeItem(modelStorageKey);
    }
  }, [modelAllowlist, modelStorageKey]);

  useEffect(() => {
    window.localStorage.setItem(
      modelStorageKey,
      JSON.stringify({
        primaryModelId,
        fallbackModelId
      })
    );
  }, [fallbackModelId, modelStorageKey, primaryModelId]);

  useEffect(() => {
    return () => {
      if (lspClientRef.current) {
        void lspClientRef.current.dispose();
        lspClientRef.current = null;
      }

      for (const source of eventSourcesRef.current.values()) {
        source.close();
      }
      eventSourcesRef.current.clear();
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
      attributeFilter: ["class"]
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
        column: event.position.column
      });
    });

    if (!lspClientRef.current) {
      lspClientRef.current = startTonLspClient({
        wsUrl: process.env.NEXT_PUBLIC_TON_LSP_WS_URL ?? "ws://localhost:3002",
        onStatus: setLspStatus
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

    const response = await fetch(`/api/projects/${projectId}/revisions/${revisionId}/working-copy`, {
      method: "POST"
    });
    if (!response.ok) {
      throw new Error("Failed to create working copy");
    }

    const payload = (await response.json()) as { workingCopy: { id: string } };
    setWorkingCopyId(payload.workingCopy.id);
    return payload.workingCopy.id;
  }, [projectId, revisionId, workingCopyId]);

  async function enableEditing() {
    setIsBusy(true);
    setLastError(null);
    try {
      await ensureWorkingCopy();
      setIsEditable(true);
      setActivityMessage("Editing enabled.");
      pushWorkbenchLog("info", "Editing mode enabled.");
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Unable to enable editing");
      pushWorkbenchLog("error", error instanceof Error ? error.message : "Unable to enable editing");
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

        const response = await fetch(`/api/projects/${projectId}/working-copies/${activeWorkingCopyId}/file`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            path,
            content: fileEntry.content
          })
        });
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
        pushWorkbenchLog("error", error instanceof Error ? error.message : "Save failed");
        return false;
      } finally {
        if (!options?.withoutBusy) {
          setIsBusy(false);
        }
      }
    },
    [ensureWorkingCopy, fileCache, isEditable, projectId, pushWorkbenchLog, workingCopyId]
  );

  const saveCurrentFile = useCallback(
    async (options?: { withoutBusy?: boolean }) => {
      if (!selectedPath) {
        return false;
      }

      return saveFilePath(selectedPath, options);
    },
    [saveFilePath, selectedPath]
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

      const isToggleBottomPanelShortcut = !event.shiftKey && normalizedKey === "j";
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

      const isSaveShortcut =
        !event.shiftKey && normalizedKey === "s";
      if (!isSaveShortcut) {
        return;
      }

      event.preventDefault();
      if (!isEditable || isBusy || !selectedPath || !dirtyPathSet.has(selectedPath)) {
        return;
      }

      void saveCurrentFile();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dirtyPathSet, isBusy, isEditable, saveCurrentFile, selectedPath]);

  async function runAudit() {
    setIsBusy(true);
    setJobState("queuing");
    setLastError(null);
    setActivityMessage("Queueing audit run...");
    pushWorkbenchLog("info", "Queueing audit run from current working copy.");

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

      const response = await fetch(`/api/projects/${projectId}/working-copies/${activeWorkingCopyId}/run-audit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          primaryModelId,
          fallbackModelId,
          includeDocsFallbackFetch: true
        })
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Run audit failed");
      }

      const payload = (await response.json()) as {
        revision: { id: string };
        auditRun: { id: string };
        verifyJobId: string | null;
      };

      const verifyJobId = payload.verifyJobId ?? `verify:${projectId}:${payload.auditRun.id}`;
      const auditJobId = `audit:${projectId}:${payload.auditRun.id}`;
      const lifecycleJobId = `finding-lifecycle:${projectId}:${payload.auditRun.id}`;

      registerJobIds([verifyJobId, auditJobId, lifecycleJobId]);
      setJobState(verifyJobId);
      setRevisionId(payload.revision.id);
      setAuditId(payload.auditRun.id);
      setWorkingCopyId(null);
      setIsEditable(false);
      setDirtyPaths([]);
      setActivityMessage(`Audit ${shortId(payload.auditRun.id)} queued.`);
      pushWorkbenchLog(
        "info",
        `Audit ${shortId(payload.auditRun.id)} queued for revision ${shortId(payload.revision.id)}.`
      );
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Run audit failed");
      pushWorkbenchLog("error", error instanceof Error ? error.message : "Run audit failed");
    } finally {
      setIsBusy(false);
    }
  }

  async function exportPdf() {
    if (!auditId) {
      return;
    }

    if (auditStatus !== "completed") {
      const message = "PDF export is available after the audit completes.";
      setLastError(message);
      setActivityMessage("Audit is still running. PDF export is unavailable.");
      pushWorkbenchLog("warn", message);
      return;
    }

    setIsBusy(true);
    setLastError(null);
    setActivityMessage("Queueing PDF export...");
    pushWorkbenchLog("info", `Queueing PDF export for audit ${shortId(auditId)}.`);
    try {
      const start = await fetch(`/api/projects/${projectId}/audits/${auditId}/pdf`, {
        method: "POST"
      });
      if (!start.ok) {
        const startErrorPayload = (await start.json().catch(() => null)) as
          | { error?: string }
          | null;
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
        const statusResponse = await fetch(`/api/projects/${projectId}/audits/${auditId}/pdf`, {
          cache: "no-store"
        });
        if (!statusResponse.ok) {
          const statusErrorPayload = (await statusResponse.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(statusErrorPayload?.error ?? "Failed to check PDF export status.");
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
          throw new Error("PDF generation failed on the worker.");
        }
      }

      if (!url) {
        throw new Error(
          latestStatus === "queued"
            ? "PDF is queued but not processing. Ensure worker is running, then try again."
            : "PDF generation is still running. Try again in a few moments."
        );
      }

      window.open(url, "_blank", "noopener,noreferrer");
      setActivityMessage("PDF is ready and opened in a new tab.");
      pushWorkbenchLog("info", `PDF export for audit ${shortId(auditId)} completed.`);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "PDF export failed");
      pushWorkbenchLog("error", error instanceof Error ? error.message : "PDF export failed");
    } finally {
      setIsBusy(false);
    }
  }

  function refreshWorkbenchData() {
    if (!revisionId) {
      return;
    }

    setFileCache({});
    setOpenTabs([]);
    setDirtyPaths([]);
    loadTree(revisionId).catch((error: unknown) => {
      setLastError(error instanceof Error ? error.message : "Refresh failed");
    });

    if (auditId) {
      loadAudit(auditId).catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : "Refresh failed");
      });
    }
  }

  async function createNewFile(pathInput: string) {
    const normalized = normalizePath(pathInput);
    if (!normalized || normalized.includes("..")) {
      setLastError("Provide a valid relative file path.");
      return;
    }

    setIsBusy(true);
    setLastError(null);
    try {
      const activeWorkingCopyId = await ensureWorkingCopy();
      const response = await fetch(`/api/projects/${projectId}/working-copies/${activeWorkingCopyId}/file`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          path: normalized,
          content: ""
        })
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to create file");
      }

      setIsEditable(true);
      setFileCache((current) => ({
        ...current,
        [normalized]: {
          content: "",
          language: detectLanguageFromPath(normalized)
        }
      }));
      setTree((current) => buildTreeFromPaths([...new Set([...treeFiles(current), normalized])]));
      openFileInEditor(normalized);
      setInlineNewFilePath("contracts/new-module.tolk");
      setIsInlineNewFile(false);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Failed to create file");
    } finally {
      setIsBusy(false);
    }
  }

  function startInlineNewFile() {
    setInlineNewFilePath((current) => current.trim() || "contracts/new-module.tolk");
    setIsInlineNewFile(true);
  }

  function cancelInlineNewFile() {
    setIsInlineNewFile(false);
    setInlineNewFilePath("contracts/new-module.tolk");
  }

  function openUploadPicker() {
    const input = document.getElementById(uploadInputId);
    if (input instanceof HTMLInputElement) {
      input.click();
    }
  }

  async function uploadFilesToWorkingCopy(event: ChangeEvent<HTMLInputElement>) {
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
        const response = await fetch(`/api/projects/${projectId}/working-copies/${activeWorkingCopyId}/file`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            path: uploadPath,
            content
          })
        });
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? `Failed to upload ${uploadPath}`);
        }

        uploadedPaths.push(uploadPath);
        setFileCache((current) => ({
          ...current,
          [uploadPath]: {
            content,
            language: detectLanguageFromPath(uploadPath)
          }
        }));
      }

      if (uploadedPaths.length) {
        setIsEditable(true);
        setTree((current) => buildTreeFromPaths([...new Set([...treeFiles(current), ...uploadedPaths])]));
        openFileInEditor(uploadedPaths[0]!);
      }
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <>
      <Input
        id={uploadInputId}
        type="file"
        multiple
        className="hidden"
        accept=".tolk,.fc,.func,.tact,.fift,.fif,.tlb,.ts,.js,.json,.md,.yaml,.yml,.xml,.lock"
        onChange={uploadFilesToWorkingCopy}
      />

      <div className="bg-background text-foreground flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border">
        <div className={cn("grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden", workbenchGridClassName)}>
        <aside className="bg-muted/30 hidden min-h-0 flex-col items-center gap-3 border-r border-border px-2 py-3 lg:flex">
          <Button
            type="button"
            size="icon-sm"
            variant={isExplorerVisible ? "default" : "ghost"}
            className={cn(isExplorerVisible ? "bg-accent text-accent-foreground hover:bg-accent/80" : "text-muted-foreground")}
            onClick={() => {
              setIsExplorerVisible((current) => !current);
            }}
            aria-label="Toggle explorer"
            title="Toggle explorer (Ctrl/Cmd+B)"
          >
            <FolderTree className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant={isFindingsVisible ? "default" : "ghost"}
            className={cn(isFindingsVisible ? "bg-accent text-accent-foreground hover:bg-accent/80" : "text-muted-foreground")}
            onClick={() => {
              setIsFindingsVisible((current) => !current);
            }}
            aria-label="Toggle findings panel"
          >
            <Shield className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant={isBottomPanelVisible ? "default" : "ghost"}
            className={cn(isBottomPanelVisible ? "bg-accent text-accent-foreground hover:bg-accent/80" : "text-muted-foreground")}
            onClick={() => {
              setIsBottomPanelVisible((current) => !current);
            }}
            aria-label="Toggle bottom panel"
            title="Toggle panel (Ctrl/Cmd+J)"
          >
            <TerminalSquare className="size-4" />
          </Button>
        </aside>

        {isExplorerVisible ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <aside className="bg-muted/30 flex min-h-0 flex-col overflow-hidden border-b border-border p-3 lg:border-r lg:border-b-0">
              <div className="mb-2 flex items-center gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="icon-sm" className="size-6">
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuLabel>Project</DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() => {
                        startInlineNewFile();
                      }}
                    >
                      <FilePlus2 className="size-3.5" />
                      New file
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={openUploadPicker}>
                      <Upload className="size-3.5" />
                      Upload files
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={refreshWorkbenchData}>
                      <RefreshCcw className="size-3.5" />
                      Refresh explorer
                    </DropdownMenuItem>
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
                <div className="truncate text-xs font-semibold">{projectName}</div>
              </div>

              {isInlineNewFile ? (
                <div className="bg-card mb-2 flex items-center gap-1 rounded-md border border-border p-1">
                  <FilePlus2 className="text-muted-foreground size-3.5" />
                  <Input
                    ref={newFileInputRef}
                    value={inlineNewFilePath}
                    onChange={(event) => setInlineNewFilePath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void createNewFile(inlineNewFilePath);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelInlineNewFile();
                      }
                    }}
                    className="h-7 text-xs"
                    placeholder="contracts/new-file.tolk"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    disabled={isBusy || !inlineNewFilePath.trim()}
                    onClick={() => {
                      void createNewFile(inlineNewFilePath);
                    }}
                  >
                    Add
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="size-7"
                    onClick={cancelInlineNewFile}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : null}

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
                  {filteredTree.length ? (
                    <TreeView
                      nodes={filteredTree}
                      selectedPath={selectedPath}
                      onSelect={openFileInEditor}
                      expandedDirectories={treeViewExpandedDirectories}
                      onToggleDirectory={toggleDirectory}
                    />
                  ) : (
                    <p className="text-muted-foreground px-1 text-xs">No files match your filter.</p>
                  )}
                </div>
              </ScrollArea>
            </aside>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuLabel>Explorer Actions</ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={(event) => {
                event.preventDefault();
                startInlineNewFile();
              }}
            >
              <FilePlus2 className="size-3.5" />
              New File
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={(event) => {
                event.preventDefault();
                openUploadPicker();
              }}
            >
              <Upload className="size-3.5" />
              Upload Files
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={(event) => {
                event.preventDefault();
                refreshWorkbenchData();
              }}
            >
              <RefreshCcw className="size-3.5" />
              Refresh Explorer
            </ContextMenuItem>
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
                              isActive ? "bg-card text-foreground" : "bg-muted/20 text-muted-foreground"
                            )}
                          >
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => openFileInEditor(path)}
                              className={cn(
                                "h-10 min-w-[150px] max-w-[240px] justify-start rounded-none px-2.5 text-xs",
                                isActive ? "text-foreground hover:bg-transparent" : "hover:bg-accent/40"
                              )}
                            >
                              <FileCode2 className="size-3" />
                              <span className="truncate">{getFileName(path)}</span>
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
                                isActive ? "opacity-100" : ""
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

              <div className="bg-card/80 flex shrink-0 items-center gap-0.5 border-l border-border px-1">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="size-6 rounded-sm"
                  disabled={isBusy || (!isEditable && !revisionId)}
                  onClick={() => {
                    void toggleEditMode();
                  }}
                  aria-label={isEditable ? "Read-only" : "Edit"}
                  title={isEditable ? "Read-only" : "Edit"}
                >
                  {isEditable ? <Lock className="size-3.5" /> : <Pencil className="size-3.5" />}
                </Button>

                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="size-6 rounded-sm"
                  disabled={!isEditable || isBusy || !selectedPath || !dirtyPathSet.has(selectedPath)}
                  onClick={() => {
                    void saveCurrentFile();
                  }}
                  aria-label="Save file"
                  title="Save file"
                >
                  <Save className="size-3.5" />
                </Button>

                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="size-6 rounded-sm"
                  disabled={!isEditable || isBusy}
                  onClick={runAudit}
                  aria-label="Run Audit"
                  title="Run Audit"
                >
                  <Play className="size-3" />
                </Button>

                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="size-6 rounded-sm"
                  disabled={!auditId || isBusy || auditStatus !== "completed"}
                  onClick={exportPdf}
                  aria-label="Export PDF"
                  title="Export PDF"
                >
                  <FileDown className="size-3.5" />
                </Button>

                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="size-6 rounded-sm"
                  disabled={isBusy || !revisionId}
                  onClick={refreshWorkbenchData}
                  aria-label="Refresh workbench"
                  title="Refresh workbench"
                >
                  <RefreshCcw className="size-3.5" />
                </Button>

                <Button
                  type="button"
                  size="icon-sm"
                  variant={isBottomPanelVisible ? "secondary" : "ghost"}
                  className="size-6 rounded-sm"
                  onClick={() => {
                    setIsBottomPanelVisible((current) => !current);
                  }}
                  aria-label="Toggle bottom panel"
                  title="Toggle bottom panel"
                >
                  <TerminalSquare className="size-3.5" />
                </Button>

                <span
                  className={cn(
                    "mx-1 hidden size-1.5 rounded-full md:inline-flex",
                    auditStatus === "failed"
                      ? "bg-destructive"
                      : isAuditInProgress
                        ? "bg-primary"
                        : "bg-muted-foreground/50"
                  )}
                  title={`Audit ${auditStatusLabel}`}
                  aria-hidden="true"
                />

                {dirtyPaths.length ? (
                  <span
                    className="mr-0.5 hidden size-1.5 rounded-full bg-destructive md:inline-flex"
                    title={`${dirtyPaths.length} unsaved file(s)`}
                    aria-hidden="true"
                  />
                ) : null}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="size-6 rounded-sm"
                      aria-label="Workbench options"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>Workbench</DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() => {
                        router.push("/dashboard");
                      }}
                    >
                      Back to dashboard
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>Primary model</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-64">
                        <DropdownMenuRadioGroup value={primaryModelId} onValueChange={setPrimaryModelId}>
                          {modelAllowlist.map((model) => (
                            <DropdownMenuRadioItem key={`toolbar-primary-${model}`} value={model}>
                              {model}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>Fallback model</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-64">
                        <DropdownMenuRadioGroup value={fallbackModelId} onValueChange={setFallbackModelId}>
                          {modelAllowlist.map((model) => (
                            <DropdownMenuRadioItem key={`toolbar-fallback-${model}`} value={model}>
                              {model}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[11px]">
                      rev {shortId(revisionId)} · audit {shortId(auditId)} · LSP {lspStatus} · job {jobState}
                    </DropdownMenuLabel>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {selectedPath ? (
              <MonacoEditor
                path={`file:///workspace/${selectedPath}`}
                value={currentFile?.content ?? ""}
                language={languageMap[currentFile?.language ?? "unknown"] ?? "plaintext"}
                theme={monacoTheme}
                options={{
                  readOnly: !isEditable,
                  minimap: { enabled: true },
                  fontSize: 13,
                  lineNumbers: "on",
                  automaticLayout: true
                }}
                onMount={onEditorMount}
                onChange={(value) => {
                  if (!selectedPath || !isEditable) {
                    return;
                  }

                  setFileCache((current) => ({
                    ...current,
                    [selectedPath]: {
                      content: value ?? "",
                      language: current[selectedPath]?.language ?? "unknown"
                    }
                  }));
                  setDirtyPaths((current) =>
                    current.includes(selectedPath) ? current : [...current, selectedPath]
                  );
                }}
              />
            ) : (
              <div className="text-muted-foreground grid h-full place-items-center text-sm">
                Open a file from the explorer or create one from the context menu.
              </div>
            )}
          </div>

          {isBottomPanelVisible ? (
            <div className="bg-card/70 border-t border-border">
              <div className="flex h-8 items-center gap-1 border-b border-border px-2 text-[11px]">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn("h-6 gap-1 px-2 text-[11px]", bottomPanelTab === "audit-log" ? "bg-accent/30" : "")}
                  onClick={() => setBottomPanelTab("audit-log")}
                >
                  <TerminalSquare className="size-3.5" />
                  Audit Log
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn("h-6 gap-1 px-2 text-[11px]", bottomPanelTab === "problems" ? "bg-accent/30" : "")}
                  onClick={() => setBottomPanelTab("problems")}
                >
                  <CircleAlert className="size-3.5" />
                  Problems
                </Button>
                <div className="text-muted-foreground ml-auto truncate">{activityMessage ?? "No active task."}</div>
              </div>

              <div className="h-32">
                {bottomPanelTab === "audit-log" ? (
                  <ScrollArea className="h-full px-2 py-2">
                    {activityFeed.length ? (
                      <div className="space-y-1.5">
                        {activityFeed.map((entry) => (
                          <div key={entry.id} className="flex items-start gap-2 text-[11px]">
                            <span className="text-muted-foreground w-16 shrink-0">
                              {new Date(entry.createdAt).toLocaleTimeString()}
                            </span>
                            <span className={cn("w-10 shrink-0 uppercase", workbenchLogLevelClass(entry.level))}>
                              {entry.level}
                            </span>
                            <span className="text-foreground break-words">{entry.message}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-xs">No activity yet.</div>
                    )}
                  </ScrollArea>
                ) : (
                  <ScrollArea className="h-full px-2 py-2">
                    {problemItems.length ? (
                      <div className="space-y-2">
                        {problemItems.map((item) => (
                          <div key={item} className="text-destructive text-xs">
                            {item}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-xs">No problems detected in this session.</div>
                    )}
                  </ScrollArea>
                )}
              </div>
            </div>
          ) : null}
        </section>

        {isFindingsVisible ? (
          <aside className="bg-muted/20 min-h-0 overflow-y-auto border-t border-border p-3 lg:border-l lg:border-t-0">
            <div className="text-muted-foreground mb-2 text-[11px] uppercase tracking-wide">Findings</div>
            <div className="space-y-2">
              {findings.length === 0 ? (
                <p className="text-muted-foreground text-xs">No findings on this audit revision.</p>
              ) : (
                findings.map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    variant="ghost"
                    className="bg-card h-auto w-full justify-start rounded border border-border p-2 text-left text-xs hover:bg-accent/40"
                    onClick={() => {
                      const path = item.payloadJson?.evidence?.filePath;
                      if (path) {
                        openFileInEditor(path);
                      }
                      const line = item.payloadJson?.evidence?.startLine;
                      if (line && editorRef.current) {
                        editorRef.current.revealLineInCenter(line);
                        editorRef.current.setPosition({ lineNumber: line, column: 1 });
                      }
                    }}
                  >
                    <div className="w-full">
                      <div className={`font-medium ${severityTone(item.payloadJson?.severity ?? item.severity)}`}>
                        {item.payloadJson?.severity ?? item.severity}
                      </div>
                      <div className="mt-1">{item.payloadJson?.title ?? "Untitled finding"}</div>
                      <div className="text-muted-foreground mt-1 line-clamp-2">{item.payloadJson?.summary}</div>
                    </div>
                  </Button>
                ))
              )}
            </div>
            {lastError ? <p className="text-destructive mt-3 text-xs">{lastError}</p> : null}
            <p className="text-muted-foreground mt-3 text-xs">Open tabs: {openTabs.length}</p>
          </aside>
        ) : null}
        </div>

        <footer className="bg-card/70 flex h-7 items-center gap-3 border-t border-border px-2 text-[11px]">
          <span className="text-foreground">{isEditable ? "Editing" : "Read-only"}</span>
          <span className="text-muted-foreground">{selectedPath ? getFileName(selectedPath) : "No file selected"}</span>
          <span className="text-muted-foreground">
            Ln {cursorPosition.line}, Col {cursorPosition.column}
          </span>
          <span className="text-muted-foreground">{currentFile?.language ?? "plaintext"}</span>
          <span className="text-muted-foreground">audit {auditStatusLabel}</span>
          <span className="text-muted-foreground">LSP {lspStatus}</span>
          <span className="text-muted-foreground">tabs {openTabs.length}</span>
          <span className="text-muted-foreground ml-auto">
            {dirtyPaths.length ? `${dirtyPaths.length} unsaved file(s)` : "All changes saved or staged"}
          </span>
        </footer>
      </div>
    </>
  );
}
