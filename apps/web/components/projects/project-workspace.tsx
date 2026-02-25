"use client";

import { TonWorkbench } from "@/components/workbench/ton-workbench";

type ProjectWorkspaceProps = {
  projectId: string;
  projectName: string;
  initialRevisionId: string | null;
  initialAuditId: string | null;
  initialWorkingCopyId: string | null;
  modelAllowlist: string[];
};

export function ProjectWorkspace({
  projectId,
  projectName,
  initialRevisionId,
  initialAuditId,
  initialWorkingCopyId,
  modelAllowlist
}: ProjectWorkspaceProps) {
  return (
    <TonWorkbench
      key={`${initialRevisionId ?? "none"}:${initialAuditId ?? "none"}:${initialWorkingCopyId ?? "none"}`}
      projectId={projectId}
      projectName={projectName}
      initialRevisionId={initialRevisionId}
      initialAuditId={initialAuditId}
      initialWorkingCopyId={initialWorkingCopyId}
      modelAllowlist={modelAllowlist}
    />
  );
}
