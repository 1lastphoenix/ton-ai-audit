import { z } from "zod";

import { DEFAULT_AUDIT_TIMEOUT_MS } from "@ton-audit/shared";

import type {
  SandboxExecutionProgressEvent,
  SandboxExecutionResponse,
  SandboxFile,
  SandboxPlan
} from "./types";

import { env } from "../env";
import { summarizeSandboxResults } from "./summary";

const sandboxStepResultSchema = z.object({
  id: z.string(),
  action: z.enum([
    "bootstrap-create-ton",
    "blueprint-build",
    "blueprint-test",
    "tact-check",
    "func-check",
    "tolk-check"
  ]),
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

  const timeoutMs = resolveSandboxRequestTimeoutMs(params.plan);
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
        steps: params.plan.steps,
        metadata: {
          projectId: params.projectId,
          revisionId: params.revisionId,
          adapter: params.plan.adapter,
          bootstrapMode: params.plan.bootstrapMode,
          seedTemplate: params.plan.seedTemplate
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
    throw new Error(`Sandbox runner request failed: ${response.status} ${body}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-ndjson")) {
    return parseSandboxNdjsonStream(response, params.onProgress);
  }

  const payload = await response.json();
  const parsed = sandboxExecutionResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  return parsed.data;
}

export { summarizeSandboxResults };
