import { z } from "zod";

import { DEFAULT_AUDIT_TIMEOUT_MS } from "@ton-audit/shared";

import type {
  SandboxExecutionProgressEvent,
  SandboxExecutionResponse,
  SandboxFile,
  SandboxPlan,
  SandboxStepAction
} from "./types";

import { env } from "../env";
import { summarizeSandboxResults } from "./summary";

const sandboxStepActions = [
  "bootstrap-create-ton",
  "blueprint-build",
  "blueprint-test",
  "tact-check",
  "func-check",
  "tolk-check",
  "security-rules-scan",
  "security-surface-scan"
] as const satisfies readonly SandboxStepAction[];

const sandboxStepActionSet = new Set<SandboxStepAction>(sandboxStepActions);

const sandboxStepResultSchema = z.object({
  id: z.string(),
  action: z.enum(sandboxStepActions),
  command: z.string(),
  args: z.array(z.string()),
  status: z.enum(["completed", "failed", "skipped", "timeout"]),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().int().nonnegative()
});

const sandboxExecutionResponseSchema = z.object({
  workspaceId: z.string(),
  mode: z.enum(["local", "docker"]),
  results: z.array(sandboxStepResultSchema)
});

const sandboxProgressStepSchema = z.object({
  id: z.string(),
  action: sandboxStepResultSchema.shape.action,
  optional: z.boolean().default(false),
  timeoutMs: z.number().int().nonnegative().default(0),
  status: z.enum(["running", "completed", "failed", "skipped", "timeout"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  exitCode: z.number().int().nullable().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional()
});

const sandboxProgressStartedStepSchema = z.object({
  id: z.string(),
  action: sandboxStepResultSchema.shape.action,
  optional: z.boolean().default(false),
  timeoutMs: z.number().int().nonnegative().default(0)
});

const sandboxProgressStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("started"),
    workspaceId: z.string(),
    mode: z.enum(["local", "docker"]),
    totalSteps: z.number().int().nonnegative(),
    steps: z.array(sandboxProgressStartedStepSchema)
  }),
  z.object({
    type: z.literal("step-started"),
    index: z.number().int().positive(),
    totalSteps: z.number().int().nonnegative(),
    step: sandboxProgressStepSchema
  }),
  z.object({
    type: z.literal("step-finished"),
    index: z.number().int().positive(),
    totalSteps: z.number().int().nonnegative(),
    step: sandboxProgressStepSchema
  }),
  z.object({
    type: z.literal("completed"),
    workspaceId: z.string(),
    mode: z.enum(["local", "docker"]),
    totalSteps: z.number().int().nonnegative(),
    results: z.array(sandboxStepResultSchema)
  }),
  z.object({
    type: z.literal("error"),
    message: z.string().min(1)
  })
]);

const SANDBOX_REQUEST_TIMEOUT_FLOOR_MS = 120_000;
const SANDBOX_REQUEST_TIMEOUT_BUFFER_MS = 15_000;
const SANDBOX_REQUEST_TIMEOUT_CAP_MS = DEFAULT_AUDIT_TIMEOUT_MS - 10_000;

function parseSandboxErrorMessage(body: string) {
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return "";
  }

  try {
    const payload = JSON.parse(trimmedBody) as { error?: unknown };
    if (payload && typeof payload === "object" && typeof payload.error === "string") {
      return payload.error;
    }
  } catch {
    // body is not JSON
  }

  return trimmedBody;
}

function extractUnsupportedSandboxAction(
  status: number,
  body: string
): SandboxStepAction | null {
  if (status !== 400) {
    return null;
  }

  const message = parseSandboxErrorMessage(body);
  const match = /invalid step action:\s*([a-z0-9-]+)/i.exec(message);
  if (!match) {
    return null;
  }

  const action = match[1]?.trim().toLowerCase();
  if (!action || !sandboxStepActionSet.has(action as SandboxStepAction)) {
    return null;
  }

  return action as SandboxStepAction;
}

function resolveSandboxRequestTimeoutMs(plan: SandboxPlan) {
  const stepBudgetMs = plan.steps.reduce((total, step) => {
    if (!Number.isFinite(step.timeoutMs) || step.timeoutMs <= 0) {
      return total + 60_000;
    }

    return total + step.timeoutMs;
  }, 0);

  return Math.max(
    SANDBOX_REQUEST_TIMEOUT_FLOOR_MS,
    Math.min(stepBudgetMs + SANDBOX_REQUEST_TIMEOUT_BUFFER_MS, SANDBOX_REQUEST_TIMEOUT_CAP_MS)
  );
}

async function parseSandboxNdjsonStream(
  response: Response,
  onProgress?: (event: SandboxExecutionProgressEvent) => void | Promise<void>
): Promise<SandboxExecutionResponse> {
  const body = response.body;
  if (!body) {
    throw new Error("Sandbox runner returned an empty stream");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completedPayload: SandboxExecutionResponse | null = null;

  const processLine = async (line: string) => {
    if (!line.trim()) {
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Sandbox runner stream returned invalid JSON: ${error instanceof Error ? error.message : "Unknown parse error"}`
      );
    }

    const parsedEvent = sandboxProgressStreamEventSchema.safeParse(parsedJson);
    if (!parsedEvent.success) {
      throw new Error(parsedEvent.error.issues.map((issue) => issue.message).join("; "));
    }

    const event = parsedEvent.data as SandboxExecutionProgressEvent;
    if (onProgress) {
      await onProgress(event);
    }

    if (event.type === "error") {
      throw new Error(`Sandbox runner stream error: ${event.message}`);
    }

    if (event.type === "completed") {
      completedPayload = {
        workspaceId: event.workspaceId,
        mode: event.mode,
        results: event.results
      };
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let lineBreakIndex = buffer.indexOf("\n");
    while (lineBreakIndex >= 0) {
      const line = buffer.slice(0, lineBreakIndex).trim();
      buffer = buffer.slice(lineBreakIndex + 1);
      await processLine(line);
      lineBreakIndex = buffer.indexOf("\n");
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    await processLine(buffer.trim());
  }

  if (!completedPayload) {
    throw new Error("Sandbox runner stream ended before a completion event was received");
  }

  return completedPayload;
}

export async function executeSandboxPlan(params: {
  files: SandboxFile[];
  plan: SandboxPlan;
  projectId: string;
  revisionId: string;
  onProgress?: (event: SandboxExecutionProgressEvent) => void | Promise<void>;
}): Promise<SandboxExecutionResponse> {
  if (!params.plan.steps.length) {
    return {
      workspaceId: `${params.projectId}:${params.revisionId}`,
      mode: "local",
      results: []
    };
  }

  let activePlan = params.plan;
  const unsupportedActions = new Set<SandboxStepAction>();

  while (activePlan.steps.length > 0) {
    const timeoutMs = resolveSandboxRequestTimeoutMs(activePlan);
    let response: Response;
    try {
      response = await fetch(`${env.SANDBOX_RUNNER_URL}/execute`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson, application/json",
          "x-sandbox-stream": "1"
        },
        body: JSON.stringify({
          files: params.files,
          steps: activePlan.steps,
          metadata: {
            projectId: params.projectId,
            revisionId: params.revisionId,
            adapter: activePlan.adapter,
            bootstrapMode: activePlan.bootstrapMode,
            seedTemplate: activePlan.seedTemplate
          }
        })
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new Error(`Sandbox runner request timed out after ${timeoutMs}ms`);
      }
      throw error;
    }

    if (!response.ok) {
      const body = await response.text();
      const unsupportedAction = extractUnsupportedSandboxAction(response.status, body);
      if (
        unsupportedAction &&
        activePlan.steps.some((step) => step.action === unsupportedAction) &&
        !unsupportedActions.has(unsupportedAction)
      ) {
        unsupportedActions.add(unsupportedAction);
        activePlan = {
          ...activePlan,
          steps: activePlan.steps.filter((step) => step.action !== unsupportedAction)
        };
        continue;
      }

      throw new Error(`Sandbox runner request failed: ${response.status} ${body}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    let execution: SandboxExecutionResponse;
    if (contentType.includes("application/x-ndjson")) {
      execution = await parseSandboxNdjsonStream(response, params.onProgress);
    } else {
      const payload = await response.json();
      const parsed = sandboxExecutionResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
      }
      execution = parsed.data;
    }

    if (unsupportedActions.size > 0) {
      return {
        ...execution,
        unsupportedActions: [...unsupportedActions]
      };
    }

    return execution;
  }

  return {
    workspaceId: `${params.projectId}:${params.revisionId}`,
    mode: "local",
    results: [],
    unsupportedActions: [...unsupportedActions]
  };
}

export { summarizeSandboxResults };
