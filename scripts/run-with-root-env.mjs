#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function parseDotEnv(content) {
  const parsed = {};
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

function loadRootEnv(rootDir) {
  const envCandidates = [".env.local", ".env"];
  for (const filename of envCandidates) {
    const envPath = path.join(rootDir, filename);
    if (fs.existsSync(envPath)) {
      return parseDotEnv(fs.readFileSync(envPath, "utf8"));
    }
  }

  return {};
}

function hasNonEmptyValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function extractPasswordFromDatabaseUrl(databaseUrl) {
  if (!hasNonEmptyValue(databaseUrl)) {
    return "";
  }

  try {
    const url = new URL(databaseUrl);
    return decodeURIComponent(url.password ?? "");
  } catch {
    return "";
  }
}

function deriveDatabaseEnv(envObject) {
  const normalized = { ...envObject };
  const user = normalized.POSTGRES_USER?.trim() || "ton";
  const database = normalized.POSTGRES_DB?.trim() || "ton_audit";

  if (!hasNonEmptyValue(normalized.DB_PASSWORD)) {
    if (hasNonEmptyValue(normalized.POSTGRES_PASSWORD)) {
      normalized.DB_PASSWORD = normalized.POSTGRES_PASSWORD.trim();
    } else {
      const fromUrl = extractPasswordFromDatabaseUrl(normalized.DATABASE_URL);
      if (fromUrl) {
        normalized.DB_PASSWORD = fromUrl;
      }
    }
  }

  if (!hasNonEmptyValue(normalized.POSTGRES_PASSWORD) && hasNonEmptyValue(normalized.DB_PASSWORD)) {
    normalized.POSTGRES_PASSWORD = normalized.DB_PASSWORD.trim();
  }

  if (!hasNonEmptyValue(normalized.DATABASE_URL) && hasNonEmptyValue(normalized.DB_PASSWORD)) {
    const encodedPassword = encodeURIComponent(normalized.DB_PASSWORD.trim());
    normalized.DATABASE_URL = `postgresql://${user}:${encodedPassword}@localhost:5432/${database}`;
  }

  return normalized;
}

function parseCommandArgs(argv) {
  const separatorIndex = argv.indexOf("--");
  const args = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : argv;

  if (args.length === 0) {
    throw new Error("No command provided. Usage: node scripts/run-with-root-env.mjs -- <command>");
  }

  return args;
}

const currentFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(currentFile);
const rootDir = path.resolve(scriptDir, "..");
const commandArgs = parseCommandArgs(process.argv.slice(2));
const command = commandArgs.join(" ");

const envFromRoot = deriveDatabaseEnv(loadRootEnv(rootDir));
const child = spawn(command, {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    ...envFromRoot
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
