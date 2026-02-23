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

const envFromRoot = loadRootEnv(rootDir);
const child = spawn(command, {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: true,
  env: {
    ...envFromRoot,
    ...process.env
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
