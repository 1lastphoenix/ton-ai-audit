"use client";

import { useState } from "react";

import { ProjectUploadForm } from "./project-upload-form";
import { TonWorkbench } from "@/components/workbench/ton-workbench";

type ProjectWorkspaceProps = {
  projectId: string;
  initialRevisionId: string | null;
  initialAuditId: string | null;
  modelAllowlist: string[];
};

export function ProjectWorkspace({
  projectId,
  initialRevisionId,
  initialAuditId,
  modelAllowlist
}: ProjectWorkspaceProps) {
  const [revisionId, setRevisionId] = useState<string | null>(initialRevisionId);
  const [auditId, setAuditId] = useState<string | null>(initialAuditId);
  const [lastJobId, setLastJobId] = useState<string | null>(null);

  return (
    <div className="grid gap-4">
      <ProjectUploadForm
        projectId={projectId}
        onUploaded={({ revisionId: newRevisionId, jobId }) => {
          setRevisionId(newRevisionId);
          setAuditId(null);
          setLastJobId(jobId);
        }}
      />
      {lastJobId ? (
        <p className="text-xs text-zinc-500">
          Ingest job queued: <span className="font-mono text-zinc-300">{lastJobId}</span>
        </p>
      ) : null}
      <TonWorkbench
        key={`${revisionId ?? "none"}:${auditId ?? "none"}`}
        projectId={projectId}
        initialRevisionId={revisionId}
        initialAuditId={auditId}
        modelAllowlist={modelAllowlist}
      />
    </div>
  );
}
