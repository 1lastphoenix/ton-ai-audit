"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StageStatus = "pending" | "running" | "completed" | "failed" | "skipped";
type VerifyStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "timeout";

export type WorkbenchExecutionStage = {
  id: string;
  label: string;
  description: string;
  status: StageStatus;
  detail: string | null;
  isCurrent: boolean;
};

export type WorkbenchExecutionVerifyStep = {
  id: string;
  action: string;
  status: VerifyStepStatus;
  durationMs: number | null;
  optional: boolean;
  isCurrent: boolean;
};

type WorkbenchExecutionTrackerProps = {
  visible: boolean;
  statusLabel: string;
  statusClassName: string;
  profileLabel: string | null;
  resolvedStages: number;
  totalStages: number;
  stagePercent: number;
  stageFailed: boolean;
  stages: WorkbenchExecutionStage[];
  stageStatusClass: (status: StageStatus) => string;
  stageStatusLabel: (status: StageStatus) => string;
  verifyPhaseLabel: string;
  verifyResolvedSteps: number;
  verifyTotalSteps: number;
  verifyPercent: number;
  verifyFailed: boolean;
  activeLabel: string | null;
  verifySteps: WorkbenchExecutionVerifyStep[];
  verifyStepStatusClass: (status: VerifyStepStatus) => string;
};

export function WorkbenchExecutionTracker(props: WorkbenchExecutionTrackerProps) {
  if (!props.visible) {
    return null;
  }

  return (
    <div className="bg-background/70 mb-2 rounded border border-border p-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-foreground font-semibold">Execution Tracker</span>
        <Badge
          variant="outline"
          className={cn(
            "h-4 border px-1.5 text-[10px] font-medium",
            props.statusClassName,
          )}
        >
          {props.statusLabel}
        </Badge>
        {props.profileLabel ? (
          <Badge
            variant="outline"
            className="h-4 border px-1.5 text-[10px] font-medium"
          >
            {props.profileLabel}
          </Badge>
        ) : null}
        <span className="text-muted-foreground ml-auto">
          {props.resolvedStages}/{props.totalStages} stages
        </span>
      </div>

      <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded">
        <div
          className={cn(
            "h-full rounded transition-[width]",
            props.stageFailed ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${props.stagePercent}%` }}
        />
      </div>

      <div className="mt-2 overflow-x-auto rounded border border-border/70">
        <table className="w-full min-w-[640px] text-[11px]">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left font-medium">Stage</th>
              <th className="px-2 py-1 text-left font-medium">Status</th>
              <th className="px-2 py-1 text-left font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {props.stages.map((stage) => (
              <tr
                key={stage.id}
                className={cn(
                  "border-t border-border/60",
                  stage.isCurrent ? "bg-primary/5" : "",
                )}
              >
                <td className="text-foreground px-2 py-1.5 font-medium">
                  {stage.label}
                </td>
                <td className="px-2 py-1.5">
                  <span
                    className={cn(
                      "inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium",
                      props.stageStatusClass(stage.status),
                    )}
                  >
                    {props.stageStatusLabel(stage.status)}
                  </span>
                </td>
                <td className="text-muted-foreground px-2 py-1.5">
                  {stage.detail ?? (stage.isCurrent ? "Running..." : stage.description)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 rounded border border-border/70">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-2 py-1.5 text-[11px]">
          <span className="text-foreground font-medium">Verification Steps</span>
          <span className="text-muted-foreground">{props.verifyPhaseLabel}</span>
          <span className="text-muted-foreground">
            {props.verifyResolvedSteps}/{props.verifyTotalSteps || 0}
          </span>
          {props.activeLabel ? (
            <span className="text-muted-foreground ml-auto max-w-[240px] truncate">
              Active: {props.activeLabel}
            </span>
          ) : null}
        </div>

        {props.verifyTotalSteps > 0 ? (
          <div className="bg-muted h-1.5 overflow-hidden">
            <div
              className={cn(
                "h-full transition-[width]",
                props.verifyFailed ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${props.verifyPercent}%` }}
            />
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[11px]">
            <thead className="bg-muted/20 text-muted-foreground">
              <tr>
                <th className="w-12 px-2 py-1 text-left font-medium">#</th>
                <th className="px-2 py-1 text-left font-medium">Step</th>
                <th className="px-2 py-1 text-left font-medium">Action</th>
                <th className="px-2 py-1 text-left font-medium">Status</th>
                <th className="px-2 py-1 text-left font-medium">Duration</th>
                <th className="px-2 py-1 text-left font-medium">Type</th>
              </tr>
            </thead>
            <tbody>
              {props.verifySteps.length ? (
                props.verifySteps.map((step, index) => (
                  <tr
                    key={step.id}
                    className={cn(
                      "border-t border-border/60",
                      step.isCurrent ? "bg-primary/5" : "",
                    )}
                  >
                    <td className="text-muted-foreground px-2 py-1.5">
                      {index + 1}
                    </td>
                    <td className="text-foreground px-2 py-1.5 font-medium">
                      {step.id}
                    </td>
                    <td className="text-muted-foreground px-2 py-1.5">
                      <span
                        className="inline-block max-w-[300px] truncate align-middle"
                        title={step.action}
                      >
                        {step.action}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={cn(
                          "inline-flex rounded border border-border px-1.5 py-0.5 uppercase",
                          props.verifyStepStatusClass(step.status),
                        )}
                      >
                        {step.status}
                      </span>
                    </td>
                    <td className="text-muted-foreground px-2 py-1.5">
                      {step.durationMs !== null
                        ? `${(step.durationMs / 1000).toFixed(1)}s`
                        : "n/a"}
                    </td>
                    <td className="text-muted-foreground px-2 py-1.5">
                      {step.optional ? "Optional" : "Required"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr className="border-t border-border/60">
                  <td colSpan={6} className="text-muted-foreground px-2 py-2">
                    No sandbox step events yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
