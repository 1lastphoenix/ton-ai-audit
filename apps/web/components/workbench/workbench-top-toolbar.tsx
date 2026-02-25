"use client";

import { type ReactNode } from "react";
import {
  FileDown,
  Lock,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCcw,
  Save,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type WorkbenchTopToolbarModelSelector = {
  id: string;
  label: string;
  value: string;
  keyPrefix: string;
  onValueChange: (value: string) => void;
};

type WorkbenchTopToolbarProps = {
  isAuditWriteLocked: boolean;
  isBusy: boolean;
  isEditable: boolean;
  revisionId: string | null;
  selectedPath: string | null;
  isSelectedPathDirty: boolean;
  onToggleEditMode: () => void;
  onSaveFile: () => void;
  auditProfile: "fast" | "deep";
  toProfileLabel: (profile: string) => string;
  onRunAudit: () => void;
  auditId: string | null;
  canExportFinalPdf: boolean;
  onExportFinalPdf: () => void;
  onRefreshWorkbench: () => void;
  isBottomPanelVisible: boolean;
  onToggleBottomPanel: () => void;
  auditStatusLabel: string;
  auditStatus: string;
  isAuditInProgress: boolean;
  dirtyPathCount: number;
  onBackToDashboard: () => void;
  modelSelectors: readonly WorkbenchTopToolbarModelSelector[];
  modelAllowlist: string[];
  onAuditProfileChange: (profile: "fast" | "deep") => void;
  lspStatus: string;
  jobState: string;
  shortId: (value: string | null, size?: number) => string;
};

function WorkbenchToolbarTooltip(props: {
  content?: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
}) {
  if (!props.content) {
    return <>{props.children}</>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{props.children}</span>
      </TooltipTrigger>
      <TooltipContent side={props.side ?? "bottom"}>{props.content}</TooltipContent>
    </Tooltip>
  );
}

function normalizeModelAllowlist(models: string[]): string[] {
  const uniqueModels: string[] = [];
  const seenModels = new Set<string>();

  for (const model of models) {
    const normalized = model.trim();
    if (!normalized || seenModels.has(normalized)) {
      continue;
    }

    seenModels.add(normalized);
    uniqueModels.push(normalized);
  }

  return uniqueModels;
}

function ModelSelectorSubmenu(props: {
  label: string;
  value: string;
  keyPrefix: string;
  modelAllowlist: string[];
  onValueChange: (value: string) => void;
}) {
  const modelOptions = normalizeModelAllowlist(props.modelAllowlist);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{props.label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        <DropdownMenuRadioGroup value={props.value} onValueChange={props.onValueChange}>
          {modelOptions.map((model) => (
            <DropdownMenuRadioItem key={`${props.keyPrefix}-${model}`} value={model}>
              {model}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function WorkbenchTopToolbar(props: WorkbenchTopToolbarProps) {
  const modeIcon: LucideIcon = props.isEditable ? Lock : Pencil;
  const ModeIcon = modeIcon;

  return (
    <div className="bg-card/80 flex shrink-0 items-center gap-0.5 border-l border-border px-1">
      <WorkbenchToolbarTooltip
        content={
          props.isAuditWriteLocked
            ? "Editing locked while audit is running"
            : props.isEditable
              ? "Read-only"
              : "Edit"
        }
      >
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-6 rounded-sm"
          disabled={props.isAuditWriteLocked || props.isBusy || (!props.isEditable && !props.revisionId)}
          onClick={props.onToggleEditMode}
          aria-label={props.isEditable ? "Read-only" : "Edit"}
        >
          <ModeIcon className="size-3.5" />
        </Button>
      </WorkbenchToolbarTooltip>

      <WorkbenchToolbarTooltip content="Save file">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-6 rounded-sm"
          disabled={
            props.isAuditWriteLocked ||
            !props.isEditable ||
            props.isBusy ||
            !props.selectedPath ||
            !props.isSelectedPathDirty
          }
          onClick={props.onSaveFile}
          aria-label="Save file"
        >
          <Save className="size-3.5" />
        </Button>
      </WorkbenchToolbarTooltip>

      <WorkbenchToolbarTooltip content={`Run ${props.toProfileLabel(props.auditProfile)} Audit`}>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-6 rounded-sm"
          disabled={props.isAuditWriteLocked || !props.isEditable || props.isBusy}
          onClick={props.onRunAudit}
          aria-label="Run Audit"
        >
          <Play className="size-3" />
        </Button>
      </WorkbenchToolbarTooltip>

      <WorkbenchToolbarTooltip content="Export Final Audit PDF">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-6 rounded-sm"
          disabled={!props.auditId || props.isBusy || !props.canExportFinalPdf}
          onClick={props.onExportFinalPdf}
          aria-label="Export PDF"
        >
          <FileDown className="size-3.5" />
        </Button>
      </WorkbenchToolbarTooltip>

      <WorkbenchToolbarTooltip content="Refresh workbench">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-6 rounded-sm"
          disabled={props.isBusy || !props.revisionId}
          onClick={props.onRefreshWorkbench}
          aria-label="Refresh workbench"
        >
          <RefreshCcw className="size-3.5" />
        </Button>
      </WorkbenchToolbarTooltip>

      <WorkbenchToolbarTooltip content="Toggle bottom panel">
        <Button
          type="button"
          size="icon-sm"
          variant={props.isBottomPanelVisible ? "secondary" : "ghost"}
          className="size-6 rounded-sm"
          onClick={props.onToggleBottomPanel}
          aria-label="Toggle bottom panel"
        >
          <TerminalSquare className="size-3.5" />
        </Button>
      </WorkbenchToolbarTooltip>

      <WorkbenchToolbarTooltip content={`Audit ${props.auditStatusLabel}`}>
        <span
          className={cn(
            "mx-1 hidden size-1.5 rounded-full md:inline-flex",
            props.auditStatus === "failed"
              ? "bg-destructive"
              : props.isAuditInProgress
                ? "bg-primary"
                : "bg-muted-foreground/50",
          )}
          aria-hidden="true"
        />
      </WorkbenchToolbarTooltip>

      {props.dirtyPathCount ? (
        <WorkbenchToolbarTooltip content={`${props.dirtyPathCount} unsaved file(s)`}>
          <span
            className="mr-0.5 hidden size-1.5 rounded-full bg-destructive md:inline-flex"
            aria-hidden="true"
          />
        </WorkbenchToolbarTooltip>
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
          <DropdownMenuItem onClick={props.onBackToDashboard}>Back to dashboard</DropdownMenuItem>
          <DropdownMenuSeparator />
          {props.modelSelectors.map((selector) => (
            <ModelSelectorSubmenu
              key={selector.id}
              label={selector.label}
              value={selector.value}
              keyPrefix={selector.keyPrefix}
              modelAllowlist={props.modelAllowlist}
              onValueChange={selector.onValueChange}
            />
          ))}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              Audit profile ({props.toProfileLabel(props.auditProfile)})
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={props.auditProfile}
                onValueChange={(value) => {
                  if (value === "fast" || value === "deep") {
                    props.onAuditProfileChange(value);
                  }
                }}
              >
                <DropdownMenuRadioItem value="deep">Deep (recommended)</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="fast">Fast</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[11px]">
            rev {props.shortId(props.revisionId)} · audit {props.shortId(props.auditId)} · LSP{" "}
            {props.lspStatus} · job {props.jobState}
          </DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
