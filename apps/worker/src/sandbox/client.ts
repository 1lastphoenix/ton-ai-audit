import { z } from "zod";

import type { SandboxExecutionResponse, SandboxFile, SandboxPlan } from "./types";

import { env } from "../env";
import { summarizeSandboxResults } from "./summary";

const sandboxStepResultSchema = z.object({
  name: z.string(),
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

export async function executeSandboxPlan(params: {
  files: SandboxFile[];
  plan: SandboxPlan;
  projectId: string;
  revisionId: string;
}): Promise<SandboxExecutionResponse> {
  if (!params.plan.steps.length) {
    return {
      workspaceId: `${params.projectId}:${params.revisionId}`,
      mode: "local",
      results: []
    };
  }

  const response = await fetch(`${env.SANDBOX_RUNNER_URL}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      files: params.files,
      steps: params.plan.steps,
      metadata: {
        projectId: params.projectId,
        revisionId: params.revisionId,
        adapter: params.plan.adapter
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Sandbox runner request failed: ${response.status} ${body}`);
  }

  const payload = await response.json();
  const parsed = sandboxExecutionResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  return parsed.data;
}

export { summarizeSandboxResults };
