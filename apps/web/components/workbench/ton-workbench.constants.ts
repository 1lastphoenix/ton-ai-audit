import {
  CircleAlert,
  RefreshCcw,
  Shield,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";

import type {
  AuditPipelineStageDefinition,
  BottomPanelTab,
  RightPanelTab,
} from "@/components/workbench/ton-workbench.types";

export const DEFAULT_MODEL_ID = "google/gemini-2.5-flash";
export const DEFAULT_NEW_FILE_NAME = "new-module.tolk";

export const findingSeverityFilters = [
  "all",
  "critical",
  "high",
  "medium",
  "low",
  "other",
] as const;

export const auditPipelineStageDefinitions = [
  {
    id: "verify-plan",
    label: "Verification Plan",
    description: "Plan compilation, toolchain detection, and adapter selection.",
  },
  {
    id: "security-scans",
    label: "Security Scans",
    description: "Deterministic security rules and surface scans.",
  },
  {
    id: "sandbox-checks",
    label: "Sandbox Checks",
    description: "Command-mapped sandbox execution of verification steps.",
  },
  {
    id: "agent-discovery",
    label: "Agent Discovery",
    description: "Initial finding candidate discovery pass.",
  },
  {
    id: "agent-validation",
    label: "Agent Validation",
    description: "Adversarial validation pass (deep profile).",
  },
  {
    id: "agent-synthesis",
    label: "Agent Synthesis",
    description: "Final synthesis pass into strict report schema.",
  },
  {
    id: "quality-gate",
    label: "Report Quality Gate",
    description: "Taxonomy, CVSS, and quality checks before acceptance.",
  },
] as const satisfies ReadonlyArray<AuditPipelineStageDefinition>;

export const bottomPanelTabConfig = [
  { id: "audit-log", label: "Audit Log", icon: TerminalSquare },
  { id: "problems", label: "Problems", icon: CircleAlert },
] as const satisfies ReadonlyArray<{
  id: BottomPanelTab;
  label: string;
  icon: LucideIcon;
}>;

export const rightPanelTabConfig = [
  { id: "findings", label: "Findings", icon: Shield },
  { id: "audit-history", label: "Audit History", icon: RefreshCcw },
] as const satisfies ReadonlyArray<{
  id: RightPanelTab;
  label: string;
  icon: LucideIcon;
}>;

export const languageMap: Record<string, string> = {
  tolk: "tolk",
  func: "func",
  tact: "tact",
  fift: "fift",
  "tl-b": "tl-b",
  unknown: "plaintext",
};

export const extensionLanguageMap: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".md": "markdown",
  ".markdown": "markdown",
  ".json": "json",
  ".xml": "xml",
};
