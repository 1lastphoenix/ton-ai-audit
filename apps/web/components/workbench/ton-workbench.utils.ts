import { normalizePath, type Language } from "@ton-audit/shared";

import {
  auditPipelineStageDefinitions,
  extensionLanguageMap,
  languageMap,
} from "@/components/workbench/ton-workbench.constants";
import type {
  AuditHistoryItem,
  AuditPipelineStageId,
  AuditPipelineStageState,
  AuditPipelineStageStatus,
  AuditPipelineState,
  AuditPipelineStatus,
  AuditProfile,
  FindingSeverityFilter,
  TreeNode,
  VerifyProgressPhase,
  VerifyProgressState,
  VerifyProgressStep,
  VerifyProgressStepStatus,
  WorkbenchLogLevel,
} from "@/components/workbench/ton-workbench.types";

export function normalizeModelAllowlist(models: string[]): string[] {
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

function getFileExtension(filePath: string | null): string {
  if (!filePath) {
    return "";
  }

  const fileName = filePath.split("/").pop() ?? filePath;
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) {
    return "";
  }

  return fileName.slice(dotIndex).toLowerCase();
}

export function resolveMonacoLanguage(params: {
  filePath: string | null;
  language: Language | undefined;
}): string {
  const canonicalLanguage = params.language ?? "unknown";
  if (canonicalLanguage !== "unknown") {
    return languageMap[canonicalLanguage] ?? "plaintext";
  }

  const extension = getFileExtension(params.filePath);
  return extensionLanguageMap[extension] ?? "plaintext";
}

export function treeFiles(nodes: TreeNode[]): string[] {
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

export function buildTreeFromPaths(paths: string[]): TreeNode[] {
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
          children: new Map<string, MutableNode>(),
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
        type: "file",
      };
    }

    const children = [...node.children.values()].map(toNode).sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });

    return {
      name: node.name,
      path: node.path,
      type: "directory",
      children,
    };
  };

  return [...root.values()].map(toNode).sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });
}

export function getFileName(filePath: string) {
  const parts = filePath.split("/");
  return parts[parts.length - 1] ?? filePath;
}

export function shortId(value: string | null, size = 8) {
  if (!value) {
    return "none";
  }

  return value.slice(0, size);
}

export function toBullMqJobId(jobId: string) {
  return jobId.replaceAll(":", "__");
}

export function toAuditStatusLabel(status: string) {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Idle";
  }
}

export function toPdfStatusLabel(status: string) {
  switch (status) {
    case "not_requested":
      return "Not requested";
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Ready";
    case "failed":
      return "Failed";
    default:
      return "Unknown";
  }
}

function normalizeSeverity(severity: string) {
  return severity.trim().toLowerCase();
}

export function toFindingSeverityBucket(
  severity: string,
): Exclude<FindingSeverityFilter, "all"> {
  const normalized = normalizeSeverity(severity);
  if (
    normalized === "critical" ||
    normalized === "high" ||
    normalized === "medium" ||
    normalized === "low"
  ) {
    return normalized;
  }

  return "other";
}

export function isFindingSeverityFilter(
  value: string,
): value is FindingSeverityFilter {
  return (
    value === "all" ||
    value === "critical" ||
    value === "high" ||
    value === "medium" ||
    value === "low" ||
    value === "other"
  );
}

export function formatSeverityLabel(severity: string) {
  const normalized = normalizeSeverity(severity);
  if (!normalized) {
    return "Unknown";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function severityBadgeClass(severity: string) {
  switch (normalizeSeverity(severity)) {
    case "critical":
      return "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300";
    case "high":
      return "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300";
    case "medium":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "low":
      return "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function auditStatusBadgeClass(status: string) {
  switch (status) {
    case "running":
      return "border-primary/40 bg-primary/10 text-primary";
    case "completed":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "failed":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "queued":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function pdfStatusBadgeClass(status: string) {
  switch (status) {
    case "completed":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "failed":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "running":
      return "border-primary/40 bg-primary/10 text-primary";
    case "queued":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function toProfileLabel(profile: string) {
  return profile === "fast" ? "FAST" : "DEEP";
}

export function resolveAuditPdfStatus(
  audit: Pick<AuditHistoryItem, "pdfStatus" | "pdfStatusByVariant">,
) {
  return (
    audit.pdfStatusByVariant?.internal ??
    audit.pdfStatus ??
    audit.pdfStatusByVariant?.client ??
    "not_requested"
  );
}

export function canExportAuditPdf(
  auditStatus?: string | null,
  pdfStatus?: string | null,
) {
  return auditStatus === "completed" || pdfStatus === "completed";
}

export function workbenchLogLevelClass(level: WorkbenchLogLevel) {
  switch (level) {
    case "error":
      return "text-destructive";
    case "warn":
      return "text-foreground";
    default:
      return "text-muted-foreground";
  }
}

export function createIdleVerifyProgress(): VerifyProgressState {
  return {
    phase: "idle",
    totalSteps: 0,
    currentStepId: null,
    toolchain: null,
    sandboxAdapter: null,
    mode: null,
    steps: [],
  };
}

export function normalizeAuditProfile(value: unknown): AuditProfile | null {
  return value === "fast" || value === "deep" ? value : null;
}

function createAuditPipelineStageMap(
  profile: AuditProfile | null = null,
): Record<AuditPipelineStageId, AuditPipelineStageState> {
  const stages = {} as Record<AuditPipelineStageId, AuditPipelineStageState>;

  for (const definition of auditPipelineStageDefinitions) {
    const isFastValidationSkip =
      definition.id === "agent-validation" && profile === "fast";
    stages[definition.id] = {
      status: isFastValidationSkip ? "skipped" : "pending",
      detail: isFastValidationSkip ? "Skipped for Fast profile." : null,
      updatedAt: null,
    };
  }

  return stages;
}

export function createIdleAuditPipeline(
  profile: AuditProfile | null = null,
): AuditPipelineState {
  return {
    profile,
    status: "idle",
    currentStageId: null,
    stages: createAuditPipelineStageMap(profile),
  };
}

export function createQueuedAuditPipeline(
  profile: AuditProfile,
): AuditPipelineState {
  return {
    ...createIdleAuditPipeline(profile),
    status: "queued",
  };
}

export function withAuditPipelineProfile(
  current: AuditPipelineState,
  profile: AuditProfile | null,
): AuditPipelineState {
  if (!profile || current.profile === profile) {
    return current;
  }

  const nextStages = { ...current.stages };
  const validationStage = nextStages["agent-validation"];
  nextStages["agent-validation"] = {
    ...validationStage,
    status:
      profile === "fast"
        ? validationStage.status === "completed"
          ? "completed"
          : "skipped"
        : validationStage.status === "skipped"
          ? "pending"
          : validationStage.status,
    detail:
      profile === "fast"
        ? validationStage.status === "completed"
          ? validationStage.detail
          : "Skipped for Fast profile."
        : validationStage.status === "skipped"
          ? null
          : validationStage.detail,
    updatedAt: Date.now(),
  };

  return {
    ...current,
    profile,
    stages: nextStages,
  };
}

export function updateAuditPipelineStage(
  current: AuditPipelineState,
  params: {
    stageId: AuditPipelineStageId;
    status: AuditPipelineStageStatus;
    detail?: string | null;
    makeCurrent?: boolean;
  },
): AuditPipelineState {
  const makeCurrent = params.makeCurrent ?? params.status === "running";
  const now = Date.now();
  const nextStages = { ...current.stages };

  if (
    makeCurrent &&
    current.currentStageId &&
    current.currentStageId !== params.stageId
  ) {
    const previousStage = nextStages[current.currentStageId];
    if (previousStage.status === "running") {
      nextStages[current.currentStageId] = {
        ...previousStage,
        status: "completed",
        updatedAt: now,
      };
    }
  }

  const stage = nextStages[params.stageId];
  nextStages[params.stageId] = {
    ...stage,
    status: params.status,
    detail: params.detail ?? stage.detail,
    updatedAt: now,
  };

  const nextStatus =
    current.status === "idle" || current.status === "queued"
      ? "running"
      : current.status;
  const nextCurrentStageId = makeCurrent
    ? params.stageId
    : current.currentStageId === params.stageId && params.status !== "running"
      ? null
      : current.currentStageId;

  return {
    ...current,
    status: nextStatus,
    currentStageId: nextCurrentStageId,
    stages: nextStages,
  };
}

export function finalizeAuditPipeline(
  current: AuditPipelineState,
  status: "completed" | "failed",
  failureDetail?: string,
): AuditPipelineState {
  const now = Date.now();
  const nextStages = { ...current.stages };

  if (status === "failed") {
    if (current.currentStageId) {
      const activeStage = nextStages[current.currentStageId];
      nextStages[current.currentStageId] = {
        ...activeStage,
        status: "failed",
        detail: failureDetail ?? activeStage.detail,
        updatedAt: now,
      };
    }

    return {
      ...current,
      status,
      currentStageId: null,
      stages: nextStages,
    };
  }

  for (const definition of auditPipelineStageDefinitions) {
    const stage = nextStages[definition.id];
    if (stage.status === "running") {
      nextStages[definition.id] = {
        ...stage,
        status: "completed",
        updatedAt: now,
      };
      continue;
    }

    if (stage.status !== "pending") {
      continue;
    }

    const shouldSkipValidation =
      definition.id === "agent-validation" && current.profile === "fast";
    const defaultStatus =
      definition.id === "quality-gate"
        ? "completed"
        : shouldSkipValidation
          ? "skipped"
          : "skipped";
    nextStages[definition.id] = {
      ...stage,
      status: defaultStatus,
      detail:
        definition.id === "quality-gate"
          ? stage.detail ?? "Quality gates passed."
          : shouldSkipValidation
            ? "Skipped for Fast profile."
            : stage.detail,
      updatedAt: now,
    };
  }

  return {
    ...current,
    status,
    currentStageId: null,
    stages: nextStages,
  };
}

export function auditPipelineStageStatusClass(status: AuditPipelineStageStatus) {
  switch (status) {
    case "running":
      return "border-primary/40 bg-primary/10 text-primary";
    case "completed":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "failed":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "skipped":
      return "border-border bg-muted text-muted-foreground";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

export function toAuditPipelineStageStatusLabel(status: AuditPipelineStageStatus) {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    default:
      return "Pending";
  }
}

export function toAuditPipelineStatusLabel(status: AuditPipelineStatus) {
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

function isVerifyProgressStepStatus(
  value: unknown,
): value is VerifyProgressStepStatus {
  return (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "skipped" ||
    value === "timeout"
  );
}

export function parseVerifyProgressStep(
  raw: unknown,
  fallbackId: string,
): VerifyProgressStep | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const payload = raw as Record<string, unknown>;
  const id =
    typeof payload.id === "string" && payload.id.trim()
      ? payload.id.trim()
      : fallbackId;
  const action =
    typeof payload.action === "string" && payload.action.trim()
      ? payload.action.trim()
      : id;
  const status = isVerifyProgressStepStatus(payload.status)
    ? payload.status
    : "pending";
  const optional = Boolean(payload.optional);
  const timeoutMs =
    typeof payload.timeoutMs === "number" && Number.isFinite(payload.timeoutMs)
      ? Math.max(0, Math.trunc(payload.timeoutMs))
      : 0;
  const durationMs =
    typeof payload.durationMs === "number" && Number.isFinite(payload.durationMs)
      ? Math.max(0, Math.trunc(payload.durationMs))
      : null;

  return {
    id,
    action,
    status,
    optional,
    timeoutMs,
    durationMs,
  };
}

export function parseVerifyProgressSteps(raw: unknown): VerifyProgressStep[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item, index) => parseVerifyProgressStep(item, `step-${index + 1}`))
    .filter((step): step is VerifyProgressStep => Boolean(step));
}

export function summarizeVerifyProgress(steps: VerifyProgressStep[]) {
  return {
    completed: steps.filter((step) => step.status === "completed").length,
    failed: steps.filter((step) => step.status === "failed").length,
    skipped: steps.filter((step) => step.status === "skipped").length,
    timeout: steps.filter((step) => step.status === "timeout").length,
  };
}

export function verifyStepStatusClass(status: VerifyProgressStepStatus) {
  switch (status) {
    case "failed":
    case "timeout":
      return "text-destructive";
    case "running":
      return "text-primary";
    case "completed":
      return "text-foreground";
    case "skipped":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

export function verifyProgressPhaseLabel(phase: VerifyProgressPhase) {
  switch (phase) {
    case "security-scan":
      return "Security Scan";
    case "plan-ready":
      return "Plan Ready";
    case "sandbox-running":
      return "Sandbox Running";
    case "sandbox-completed":
      return "Sandbox Completed";
    case "sandbox-failed":
      return "Sandbox Failed";
    case "sandbox-skipped":
      return "Sandbox Skipped";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "Idle";
  }
}

function resolveLspWebSocketUrl(rawUrl?: string) {
  const fallback = "ws://localhost:3002";
  const configuredUrl = rawUrl?.trim() || fallback;

  if (typeof window === "undefined") {
    return configuredUrl;
  }

  try {
    const parsed = new URL(configuredUrl);

    if (window.location.protocol === "https:" && parsed.protocol === "ws:") {
      parsed.protocol = "wss:";
    }

    return parsed.toString();
  } catch {
    return configuredUrl;
  }
}

function deriveLspSiblingHost(browserHost: string) {
  const normalizedHost = browserHost.trim().toLowerCase();
  if (!normalizedHost.includes(".")) {
    return null;
  }

  const labels = normalizedHost.split(".").filter(Boolean);
  if (!labels.length) {
    return null;
  }

  if (labels[0] === "lsp") {
    return normalizedHost;
  }

  if (labels.length === 2) {
    return `lsp.${normalizedHost}`;
  }

  return `lsp.${labels.slice(1).join(".")}`;
}

export function buildLspWebSocketUrls(rawUrl?: string) {
  const primary = resolveLspWebSocketUrl(rawUrl);
  const candidates = [primary];

  try {
    const parsed = new URL(primary);
    if (parsed.hostname === "localhost") {
      const fallback = new URL(primary);
      fallback.hostname = "127.0.0.1";
      candidates.push(fallback.toString());
    } else if (parsed.hostname === "127.0.0.1") {
      const fallback = new URL(primary);
      fallback.hostname = "localhost";
      candidates.push(fallback.toString());
    }

    if (typeof window !== "undefined") {
      const browserHost = window.location.hostname.trim().toLowerCase();
      const isLoopbackHost =
        parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      const browserIsLoopback =
        browserHost === "localhost" || browserHost === "127.0.0.1";
      const hasLikelyInternalHost =
        !parsed.hostname.includes(".") && !isLoopbackHost;

      if ((isLoopbackHost || hasLikelyInternalHost) && browserHost && !browserIsLoopback) {
        const browserHostCandidateWithPort = new URL(primary);
        browserHostCandidateWithPort.hostname = browserHost;
        candidates.push(browserHostCandidateWithPort.toString());

        const browserHostCandidateDefaultPort = new URL(primary);
        browserHostCandidateDefaultPort.hostname = browserHost;
        browserHostCandidateDefaultPort.port = "";
        candidates.push(browserHostCandidateDefaultPort.toString());

        const browserHostPathCandidate = new URL(browserHostCandidateDefaultPort.toString());
        browserHostPathCandidate.pathname = "/lsp";
        candidates.push(browserHostPathCandidate.toString());

        const siblingHost = deriveLspSiblingHost(browserHost);
        if (siblingHost) {
          const siblingHostCandidate = new URL(primary);
          siblingHostCandidate.hostname = siblingHost;
          siblingHostCandidate.port = "";
          candidates.push(siblingHostCandidate.toString());
        }
      }
    }
  } catch {
    // Keep primary URL only when parsing fails.
  }

  return [...new Set(candidates)];
}

export function collectDirectoryPaths(nodes: TreeNode[]): string[] {
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

export function getParentDirectories(filePath: string): string[] {
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
