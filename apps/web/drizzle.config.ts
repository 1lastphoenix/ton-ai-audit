import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Config } from "drizzle-kit";

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
      (rawValue.startsWith("\"") && rawValue.endsWith("\"")) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;

    parsed[key] = value;
  }

  return parsed;
}

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  const rootDir = path.resolve(currentDir, "..", "..");
  const envCandidates = [".env.local", ".env"];

  for (const filename of envCandidates) {
    const envPath = path.join(rootDir, filename);
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const parsed = parseDotEnv(fs.readFileSync(envPath, "utf8"));
    if (parsed.DATABASE_URL?.trim()) {
      return parsed.DATABASE_URL.trim();
    }
  }

  return "";
}

export default {
  schema: "../../packages/shared/src/db-schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: resolveDatabaseUrl()
  },
  strict: true,
  verbose: true
} satisfies Config;
