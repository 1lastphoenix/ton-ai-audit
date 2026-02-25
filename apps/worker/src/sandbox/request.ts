import path from "node:path";

import { z } from "zod";

import { DEFAULT_UPLOAD_MAX_FILES } from "@ton-audit/shared";

import type { SandboxFile, SandboxStep, SandboxStepAction } from "./types";

const sandboxFileSchema = z.object({
  path: z.string().min(1),
  content: z.string()
});

const sandboxStepActionSchema = z.enum([
  "bootstrap-create-ton",
  "blueprint-build",
  "blueprint-test",
  "tact-check",
  "func-check",
  "tolk-check",
  "security-rules-scan",
  "security-surface-scan"
]) satisfies z.ZodType<SandboxStepAction>;

const sandboxStepSchema = z
  .object({
    id: z.string().min(1),
    action: sandboxStepActionSchema,
    timeoutMs: z.number().int().positive().max(20 * 60 * 1000).default(60_000),
    optional: z.boolean().optional()
  })
  .strict();

const sandboxMetadataSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    revisionId: z.string().uuid().optional(),
    adapter: z.string().min(1).optional(),
    bootstrapMode: z.enum(["none", "create-ton"]).optional(),
    seedTemplate: z.enum(["tact-empty", "tolk-empty", "func-empty"]).nullable().optional()
  })
  .strict();

const sandboxRequestSchema = z.object({
  files: z.array(sandboxFileSchema).max(DEFAULT_UPLOAD_MAX_FILES, `Max files is ${DEFAULT_UPLOAD_MAX_FILES}`),
  steps: z.array(sandboxStepSchema),
  metadata: sandboxMetadataSchema.optional()
});

export type SandboxRequest = {
  files: SandboxFile[];
  steps: SandboxStep[];
  metadata?: z.infer<typeof sandboxMetadataSchema>;
};

function isUnsafePath(targetPath: string) {
  if (!targetPath || targetPath.includes("\0")) {
    return true;
  }

  const normalized = targetPath.replace(/\\/g, "/").trim();
  if (!normalized) {
    return true;
  }

  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    return true;
  }

  const resolved = path.posix.normalize(normalized);
  const parts = resolved.split("/");
  return parts.some((part) => part === "..");
}

export function validateSandboxRequest(payload: unknown): SandboxRequest {
  const parsed = sandboxRequestSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  for (const file of parsed.data.files) {
    if (isUnsafePath(file.path)) {
      throw new Error(`Unsafe sandbox file path detected: ${file.path}`);
    }
  }

  return parsed.data;
}
