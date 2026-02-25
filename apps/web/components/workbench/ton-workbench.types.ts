import type { LucideIcon } from "lucide-react";

import type { Language } from "@ton-audit/shared";
import type { WorkbenchTreeNode } from "@/components/workbench/workbench-ui-utils";

export type TreeNode = WorkbenchTreeNode;

export type FindingPayload = {
  title: string;
  severity: string;
  summary: string;
  impact?: string;
  likelihood?: string;
  exploitPath?: string;
  confidence?: number;
  remediation: string;
  taxonomy?: Array<{
    standard: "owasp-sc" | "cwe" | "swc";
    id: string;
    title?: string;
  }>;
  cvssV31?: {
    vector: string;
    baseScore: number;
    severity?: "none" | "low" | "medium" | "high" | "critical";
  };
  preconditions?: string[];
  attackScenario?: string;
  affectedContracts?: string[];
  exploitability?: string;
  businessImpact?: string;
  technicalImpact?: string;
  fixPriority?: "p0" | "p1" | "p2" | "p3";
  verificationPlan?: string[];
  evidence: {
    filePath: string;
    startLine: number;
    endLine: number;
    snippet: string;
  };
};

export type AuditFindingInstance = {
  id: string;
  payloadJson: FindingPayload;
  severity: string;
};

export type PdfExportStatus =
  | "not_requested"
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type AuditProfile = "fast" | "deep";

export type AuditHistoryItem = {
  id: string;
  revisionId: string;
  revisionSource: "upload" | "working-copy";
  revisionDescription: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  profile: AuditProfile;
  engineVersion: string;
  reportSchemaVersion: number;
  primaryModelId: string;
  fallbackModelId: string;
  findingCount: number;
  pdfStatus: PdfExportStatus;
  pdfStatusByVariant?: {
    client?: PdfExportStatus;
    internal?: PdfExportStatus;
  };
};

export type AuditCompareItem = {
  findingId: string;
  title: string;
  severity: string;
  filePath: string;
  startLine: number;
};

export type AuditCompareResponse = {
  fromAudit: {
    id: string;
    revisionId: string;
    createdAt: string;
    findingCount: number;
  };
  toAudit: {
    id: string;
    revisionId: string;
    createdAt: string;
    findingCount: number;
  };
  summary: {
    findings: {
      fromTotal: number;
      toTotal: number;
      newCount: number;
      resolvedCount: number;
      persistingCount: number;
      severityChangedCount: number;
    };
    files: {
      addedCount: number;
      removedCount: number;
      unchangedCount: number;
    };
  };
  findings: {
    newlyDetected: AuditCompareItem[];
    resolved: AuditCompareItem[];
    persisting: Array<
      Omit<AuditCompareItem, "severity"> & {
        fromSeverity: string;
        toSeverity: string;
      }
    >;
  };
  files: {
    added: string[];
    removed: string[];
    unchanged: string[];
  };
};

export type WorkbenchLogLevel = "info" | "warn" | "error";

export type WorkbenchLogEntry = {
  id: string;
  createdAt: string;
  level: WorkbenchLogLevel;
  message: string;
};

export type WorkbenchFileEntry = {
  content: string;
  language: Language;
};

export type VerifyProgressStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "timeout";

export type VerifyProgressStep = {
  id: string;
  action: string;
  status: VerifyProgressStepStatus;
  optional: boolean;
  timeoutMs: number;
  durationMs: number | null;
};

export type VerifyProgressPhase =
  | "idle"
  | "security-scan"
  | "plan-ready"
  | "sandbox-running"
  | "sandbox-completed"
  | "sandbox-failed"
  | "sandbox-skipped"
  | "completed"
  | "failed";

export type VerifyProgressState = {
  phase: VerifyProgressPhase;
  totalSteps: number;
  currentStepId: string | null;
  toolchain: string | null;
  sandboxAdapter: string | null;
  mode: string | null;
  steps: VerifyProgressStep[];
};

export type AuditPipelineStageId =
  | "verify-plan"
  | "security-scans"
  | "sandbox-checks"
  | "agent-discovery"
  | "agent-validation"
  | "agent-synthesis"
  | "quality-gate";

export type AuditPipelineStageDefinition = {
  id: AuditPipelineStageId;
  label: string;
  description: string;
};

export type AuditPipelineStageStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type AuditPipelineStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type AuditPipelineStageState = {
  status: AuditPipelineStageStatus;
  detail: string | null;
  updatedAt: number | null;
};

export type AuditPipelineState = {
  profile: AuditProfile | null;
  status: AuditPipelineStatus;
  currentStageId: AuditPipelineStageId | null;
  stages: Record<AuditPipelineStageId, AuditPipelineStageState>;
};

export type BackendJobEvent = {
  id: string;
  projectId: string | null;
  queue: string;
  jobId: string;
  event: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type TonWorkbenchProps = {
  projectId: string;
  projectName: string;
  initialRevisionId: string | null;
  initialAuditId: string | null;
  initialWorkingCopyId: string | null;
  modelAllowlist: string[];
};

export type ExplorerActionConfig = {
  id: string;
  dropdownLabel: string;
  contextLabel: string;
  icon: LucideIcon;
  onDropdownSelect: () => void;
  onContextSelect: () => void;
};

export type RailToggleConfig = {
  id: string;
  active: boolean;
  icon: LucideIcon;
  ariaLabel: string;
  title?: string;
  onClick: () => void;
};

export type RightPanelTab = "findings" | "audit-history";

export type BottomPanelTab = "audit-log" | "problems";

export type FindingSeverityFilter =
  | "all"
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "other";
