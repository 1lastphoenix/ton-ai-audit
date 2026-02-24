import fs from "node:fs";
import path from "node:path";
import { type z } from "zod";

import { envConfigSchema, parseAdminEmails, parseModelAllowlist } from "@ton-audit/shared";

type ParsedEnv = Omit<z.infer<typeof envConfigSchema>, "AUDIT_MODEL_ALLOWLIST" | "ADMIN_EMAILS"> & {
  AUDIT_MODEL_ALLOWLIST: string[];
  ADMIN_EMAILS: string[];
};

let cachedEnv: ParsedEnv | null = null;
let rootEnvLoaded = false;

function parseDotEnv(content: string) {
  const parsed: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const stripped = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = stripped.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = stripped.slice(0, separatorIndex).trim();
    const rawValue = stripped.slice(separatorIndex + 1).trim();
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;

    parsed[key] = value;
  }

  return parsed;
}

function findWorkspaceRoot(startDir: string) {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (fs.existsSync(path.join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return startDir;
    }
    currentDir = parentDir;
  }
}

function buildRootEnvCandidates() {
  const nodeEnv = process.env.NODE_ENV?.trim() || "development";
  const candidates = [`.env.${nodeEnv}.local`, ".env.local", `.env.${nodeEnv}`, ".env"];
  // Preserve order while removing duplicates (e.g. NODE_ENV="local").
  return [...new Set(candidates)];
}

function loadRootEnvDefaults() {
  if (rootEnvLoaded) {
    return;
  }

  const workspaceRoot = findWorkspaceRoot(process.cwd());
  const envFromFiles: Record<string, string> = {};

  // Load lowest priority first so later files override earlier ones.
  for (const filename of [...buildRootEnvCandidates()].reverse()) {
    const envPath = path.join(workspaceRoot, filename);
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const parsed = parseDotEnv(fs.readFileSync(envPath, "utf8"));
    Object.assign(envFromFiles, parsed);
  }

  for (const [key, value] of Object.entries(envFromFiles)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  rootEnvLoaded = true;
}

export function getEnv(): ParsedEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  loadRootEnvDefaults();

  const parsed = envConfigSchema.safeParse(process.env);

  if (!parsed.success) {
    const issueText = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid environment configuration: ${issueText}`);
  }

  cachedEnv = {
    ...parsed.data,
    AUDIT_MODEL_ALLOWLIST: parseModelAllowlist(parsed.data.AUDIT_MODEL_ALLOWLIST),
    ADMIN_EMAILS: parseAdminEmails(parsed.data.ADMIN_EMAILS)
  };

  return cachedEnv;
}

function bindIfFunction<T extends object>(instance: T, value: unknown) {
  if (typeof value === "function") {
    return value.bind(instance);
  }

  return value;
}

export const env = new Proxy({} as ParsedEnv, {
  get(_target, property) {
    const instance = getEnv();
    const value = Reflect.get(instance, property, instance);
    return bindIfFunction(instance, value);
  }
});
