import type { MutableRefObject } from "react";
import { ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TreeNode } from "@/components/workbench/ton-workbench.types";

export type WorkbenchInlineNewFileDraft = {
  parentPath: string | null;
  value: string;
  isBusy: boolean;
  rowRef: MutableRefObject<HTMLDivElement | null>;
  inputRef: MutableRefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

type TreeViewProps = {
  nodes: TreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  expandedDirectories: Set<string>;
  onToggleDirectory: (path: string) => void;
  onContextNode?: (node: { path: string; type: "file" | "directory" }) => void;
  parentPath?: string | null;
  inlineNewFileDraft?: WorkbenchInlineNewFileDraft | null;
  depth?: number;
};

export function TreeView(props: TreeViewProps) {
  const {
    nodes,
    selectedPath,
    onSelect,
    expandedDirectories = new Set<string>(),
    onToggleDirectory = () => undefined,
    onContextNode = () => undefined,
    parentPath = null,
    inlineNewFileDraft = null,
    depth = 0,
  } = props;
  const shouldRenderInlineNewFile = Boolean(
    inlineNewFileDraft && inlineNewFileDraft.parentPath === parentPath,
  );

  return (
    <ul className="space-y-0.5 text-xs">
      {shouldRenderInlineNewFile && inlineNewFileDraft ? (
        <li key={`new-file-${parentPath ?? "root"}`}>
          <div
            ref={inlineNewFileDraft.rowRef}
            className="flex h-6 w-full items-center gap-1 rounded px-1 text-left text-xs"
            style={{ paddingLeft: `${depth * 12 + 22}px` }}
          >
            <FileCode2 className="text-muted-foreground size-3" />
            <Input
              ref={inlineNewFileDraft.inputRef}
              value={inlineNewFileDraft.value}
              onChange={(event) => inlineNewFileDraft.onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  inlineNewFileDraft.onSubmit();
                  return;
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  inlineNewFileDraft.onCancel();
                }
              }}
              className="h-5 rounded-sm px-1 text-xs"
              placeholder="new-file.tolk"
              disabled={inlineNewFileDraft.isBusy}
              aria-label="New file name"
            />
          </div>
        </li>
      ) : null}
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
                onContextMenu={() => {
                  onContextNode({ path: node.path, type: "directory" });
                }}
                className="h-6 w-full justify-start gap-1 rounded px-1 text-left text-xs"
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
              >
                {expanded ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                {expanded ? (
                  <FolderOpen className="size-3.5" />
                ) : (
                  <Folder className="size-3.5" />
                )}
                <span className="truncate">{node.name}</span>
              </Button>
              {expanded ? (
                <TreeView
                  nodes={node.children ?? []}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  expandedDirectories={expandedDirectories}
                  onToggleDirectory={onToggleDirectory}
                  onContextNode={onContextNode}
                  parentPath={node.path}
                  inlineNewFileDraft={inlineNewFileDraft}
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
              onContextMenu={() => {
                onContextNode({ path: node.path, type: "file" });
              }}
              className={cn(
                "h-6 w-full justify-start gap-1 rounded px-1 text-left text-xs",
                selectedPath === node.path
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-accent/60",
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
