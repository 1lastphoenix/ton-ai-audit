"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { FileCode2, FolderTree, Play, RefreshCcw, Shield, FileDown } from "lucide-react";

import type { Language } from "@ton-audit/shared";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  registerTonLanguages,
  startTonLspClient,
  type TonLspStatus
} from "@/lib/editor/ton-lsp-client";

type TreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
};

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

type TonWorkbenchProps = {
  projectId: string;
  initialRevisionId: string | null;
  initialAuditId: string | null;
  modelAllowlist: string[];
};

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

function severityTone(severity: string) {
  switch (severity) {
    case "critical":
      return "text-red-400";
    case "high":
      return "text-orange-400";
    case "medium":
      return "text-amber-300";
    case "low":
      return "text-yellow-200";
    default:
      return "text-sky-300";
  }
}

function TreeView(props: {
  nodes: TreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const { nodes, selectedPath, onSelect } = props;

  return (
    <ul className="space-y-0.5 text-xs">
      {nodes.map((node) =>
        node.type === "directory" ? (
          <li key={node.path}>
            <div className="flex items-center gap-1 text-zinc-400">
              <FolderTree className="size-3" />
              <span>{node.name}</span>
            </div>
            <div className="ml-4">
              <TreeView nodes={node.children ?? []} selectedPath={selectedPath} onSelect={onSelect} />
            </div>
          </li>
        ) : (
          <li key={node.path}>
            <button
              type="button"
              onClick={() => onSelect(node.path)}
              className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left ${
                selectedPath === node.path
                  ? "bg-sky-500/20 text-sky-200"
                  : "text-zinc-300 hover:bg-white/5"
              }`}
            >
              <FileCode2 className="size-3" />
              <span className="truncate">{node.name}</span>
            </button>
          </li>
        )
      )}
    </ul>
  );
}

export function TonWorkbench(props: TonWorkbenchProps) {
  const { projectId, initialRevisionId, initialAuditId, modelAllowlist } = props;

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const lspClientRef = useRef<{ dispose: () => Promise<void> | void } | null>(null);
  const [revisionId, setRevisionId] = useState(initialRevisionId);
  const [auditId, setAuditId] = useState(initialAuditId);
  const [workingCopyId, setWorkingCopyId] = useState<string | null>(null);
  const [isEditable, setIsEditable] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileCache, setFileCache] = useState<Record<string, { content: string; language: Language }>>({});
  const [findings, setFindings] = useState<AuditFindingInstance[]>([]);
  const [primaryModelId, setPrimaryModelId] = useState(modelAllowlist[0] ?? "openai/gpt-5");
  const [fallbackModelId, setFallbackModelId] = useState(
    modelAllowlist[1] ?? modelAllowlist[0] ?? "openai/gpt-5-mini"
  );
  const [jobState, setJobState] = useState<string>("idle");
  const [lspStatus, setLspStatus] = useState<TonLspStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);

  const allFiles = useMemo(() => treeFiles(tree), [tree]);
  const currentFile = selectedPath ? fileCache[selectedPath] : null;

  const loadTree = useCallback(
    async (targetRevisionId: string) => {
      const response = await fetch(
        `/api/projects/${projectId}/revisions/${targetRevisionId}/tree`,
        { cache: "no-store" }
      );
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
      const response = await fetch(
        `/api/projects/${projectId}/revisions/${revisionId}/file?${search}`,
        { cache: "no-store" }
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
        findings: AuditFindingInstance[];
      };

      setFindings(payload.findings ?? []);
    },
    [projectId]
  );

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
    return () => {
      if (lspClientRef.current) {
        void lspClientRef.current.dispose();
        lspClientRef.current = null;
      }
    };
  }, []);

  const onEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    registerTonLanguages(monaco);

    if (!lspClientRef.current) {
      lspClientRef.current = startTonLspClient({
        wsUrl: process.env.NEXT_PUBLIC_TON_LSP_WS_URL ?? "ws://localhost:3002",
        onStatus: setLspStatus
      });
    }
  };

  async function enableEditing() {
    if (!revisionId) {
      return;
    }

    if (!workingCopyId) {
      setIsBusy(true);
      try {
        const response = await fetch(
          `/api/projects/${projectId}/revisions/${revisionId}/working-copy`,
          {
            method: "POST"
          }
        );
        if (!response.ok) {
          throw new Error("Failed to create working copy");
        }
        const payload = (await response.json()) as { workingCopy: { id: string } };
        setWorkingCopyId(payload.workingCopy.id);
      } finally {
        setIsBusy(false);
      }
    }

    setIsEditable(true);
  }

  async function saveCurrentFile() {
    if (!workingCopyId || !selectedPath || !currentFile) {
      return;
    }

    setIsBusy(true);
    setLastError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/working-copies/${workingCopyId}/file`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            path: selectedPath,
            content: currentFile.content
          })
        }
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Save failed");
      }
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Save failed");
    } finally {
      setIsBusy(false);
    }
  }

  async function runAudit() {
    if (!workingCopyId) {
      return;
    }

    setIsBusy(true);
    setJobState("queuing");
    setLastError(null);

    try {
      if (selectedPath && currentFile) {
        await saveCurrentFile();
      }

      const response = await fetch(
        `/api/projects/${projectId}/working-copies/${workingCopyId}/run-audit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            primaryModelId,
            fallbackModelId,
            includeDocsFallbackFetch: true
          })
        }
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

      setJobState(payload.verifyJobId ? `verify:${payload.verifyJobId}` : "queued");
      setRevisionId(payload.revision.id);
      setAuditId(payload.auditRun.id);
      setWorkingCopyId(null);
      setIsEditable(false);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Run audit failed");
    } finally {
      setIsBusy(false);
    }
  }

  async function exportPdf() {
    if (!auditId) {
      return;
    }

    setIsBusy(true);
    setLastError(null);
    try {
      const start = await fetch(`/api/projects/${projectId}/audits/${auditId}/pdf`, {
        method: "POST"
      });
      if (!start.ok) {
        throw new Error("Failed to queue PDF");
      }

      let url: string | null = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const statusResponse = await fetch(
          `/api/projects/${projectId}/audits/${auditId}/pdf`,
          { cache: "no-store" }
        );
        const statusPayload = (await statusResponse.json()) as {
          status: string;
          url: string | null;
        };

        if (statusPayload.url) {
          url = statusPayload.url;
          break;
        }
      }

      if (!url) {
        throw new Error("PDF generation is still running");
      }

      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "PDF export failed");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="grid min-h-[78vh] grid-cols-[52px_260px_minmax(0,1fr)_320px] overflow-hidden rounded-xl border border-white/10 bg-[#0d1117] text-zinc-200">
      <aside className="flex flex-col items-center gap-3 border-r border-white/10 bg-[#0a0e14] px-2 py-3">
        <button type="button" className="rounded bg-white/10 p-2 text-sky-300">
          <FolderTree className="size-4" />
        </button>
        <button type="button" className="rounded p-2 text-zinc-500">
          <Shield className="size-4" />
        </button>
      </aside>

      <aside className="border-r border-white/10 bg-[#11161e] p-3">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-zinc-400">Explorer</div>
        <TreeView nodes={tree} selectedPath={selectedPath} onSelect={setSelectedPath} />
      </aside>

      <section className="flex min-w-0 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#11161e] px-3 py-2 text-xs">
          <span className="rounded bg-white/5 px-2 py-1 text-zinc-300">
            {selectedPath ?? "No file selected"}
          </span>
          <Separator orientation="vertical" className="h-4 bg-white/10" />
          {!isEditable ? (
            <Button size="sm" variant="outline" disabled={isBusy || !revisionId} onClick={enableEditing}>
              Enable editing
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={isBusy} onClick={saveCurrentFile}>
              Save file
            </Button>
          )}
          <select
            className="h-8 rounded border border-white/10 bg-black/30 px-2 text-xs"
            value={primaryModelId}
            onChange={(event) => setPrimaryModelId(event.target.value)}
          >
            {modelAllowlist.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <select
            className="h-8 rounded border border-white/10 bg-black/30 px-2 text-xs"
            value={fallbackModelId}
            onChange={(event) => setFallbackModelId(event.target.value)}
          >
            {modelAllowlist.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={!isEditable || isBusy} onClick={runAudit}>
            <Play className="mr-1 size-3" />
            Run Audit
          </Button>
          <Button size="sm" variant="outline" disabled={!auditId || isBusy} onClick={exportPdf}>
            <FileDown className="mr-1 size-3" />
            Export PDF
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={isBusy || !revisionId}
            onClick={() => {
              if (!revisionId) {
                return;
              }
              setFileCache({});
              loadTree(revisionId).catch(() => undefined);
              if (auditId) {
                loadAudit(auditId).catch(() => undefined);
              }
            }}
          >
            <RefreshCcw className="mr-1 size-3" />
            Refresh
          </Button>
          <span className="ml-auto text-zinc-500">
            {isEditable ? "working copy" : "audited revision"} | {jobState} | lsp:{lspStatus}
          </span>
        </header>

        <div className="min-h-0 flex-1">
          {selectedPath ? (
            <Editor
              path={`file:///workspace/${selectedPath}`}
              value={currentFile?.content ?? ""}
              language={languageMap[currentFile?.language ?? "unknown"] ?? "plaintext"}
              theme="vs-dark"
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
              }}
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-zinc-500">
              Upload a revision and open a file to start.
            </div>
          )}
        </div>
      </section>

      <aside className="border-l border-white/10 bg-[#0f131a] p-3">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-zinc-400">Findings</div>
        <div className="space-y-2">
          {findings.length === 0 ? (
            <p className="text-xs text-zinc-500">No findings on this audit revision.</p>
          ) : (
            findings.map((item) => (
              <button
                key={item.id}
                type="button"
                className="w-full rounded border border-white/10 bg-white/[0.03] p-2 text-left text-xs hover:bg-white/[0.06]"
                onClick={() => {
                  const path = item.payloadJson?.evidence?.filePath;
                  if (path) {
                    setSelectedPath(path);
                  }
                  const line = item.payloadJson?.evidence?.startLine;
                  if (line && editorRef.current) {
                    editorRef.current.revealLineInCenter(line);
                    editorRef.current.setPosition({ lineNumber: line, column: 1 });
                  }
                }}
              >
                <div className={`font-medium ${severityTone(item.payloadJson?.severity ?? item.severity)}`}>
                  {item.payloadJson?.severity ?? item.severity}
                </div>
                <div className="mt-1 text-zinc-100">{item.payloadJson?.title ?? "Untitled finding"}</div>
                <div className="mt-1 line-clamp-2 text-zinc-400">{item.payloadJson?.summary}</div>
              </button>
            ))
          )}
        </div>
        {lastError ? <p className="mt-3 text-xs text-red-400">{lastError}</p> : null}
        <p className="mt-3 text-xs text-zinc-500">Open files: {allFiles.length}</p>
      </aside>
    </div>
  );
}
