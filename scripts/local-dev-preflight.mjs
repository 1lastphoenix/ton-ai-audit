#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const requiredEnvKeys = [
  "DB_PASSWORD",
  "REDIS_URL",
  "MINIO_ENDPOINT",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "MINIO_BUCKET",
  "BETTER_AUTH_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "OPENROUTER_API_KEY",
  "OPENROUTER_EMBEDDINGS_MODEL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_TON_LSP_WS_URL",
  "MINIO_ROOT_USER",
  "MINIO_ROOT_PASSWORD"
];

export const devServeCommand =
  "pnpm --parallel --filter @ton-audit/web --filter @ton-audit/worker dev";

export const localComposeServices = [
  "postgres",
  "redis",
  "minio",
  "sandbox-runner",
  "lsp-service"
];

function getWorkspaceRequireCandidates() {
  const candidates = [
    path.resolve(process.cwd(), "apps", "web", "package.json"),
    path.resolve(process.cwd(), "apps", "worker", "package.json"),
    path.resolve(process.cwd(), "package.json")
  ];

  return candidates.filter((candidate) => fs.existsSync(candidate));
}

function canResolveWorkspaceModule(moduleId) {
  for (const entrypoint of getWorkspaceRequireCandidates()) {
    try {
      const requireFromWorkspace = createRequire(entrypoint);
      requireFromWorkspace.resolve(moduleId);
      return true;
    } catch {
      // continue trying next workspace package
    }
  }

  return false;
}

function loadWorkspaceModule(moduleId) {
  for (const entrypoint of getWorkspaceRequireCandidates()) {
    try {
      const requireFromWorkspace = createRequire(entrypoint);
      return requireFromWorkspace(moduleId);
    } catch {
      // continue trying next workspace package
    }
  }

  throw new Error(
    `Cannot resolve ${moduleId} from workspace packages. ` +
      `Run "pnpm install --frozen-lockfile" and retry.`
  );
}

export function parseDotEnv(content) {
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

function isPlaceholderValue(value) {
  if (typeof value !== "string") {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return normalized.startsWith("replace-with-");
}

export function findMissingRequiredEnv(envObject, requiredKeys = requiredEnvKeys) {
  return requiredKeys.filter((key) => isPlaceholderValue(envObject[key]));
}

function loadEnvFile(envFilePath) {
  if (!fs.existsSync(envFilePath)) {
    throw new Error(
      `Missing ${envFilePath}. Create it first (copy from .env.example and fill required values).`
    );
  }

  const rawContent = fs.readFileSync(envFilePath, "utf8");
  return parseDotEnv(rawContent);
}

function runCommandCapture(command, envObject) {
  const result = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    env: {
      ...process.env,
      ...envObject
    }
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `Command failed: ${command}`);
  }

  return result.stdout ?? "";
}

function runCommand(command, envObject) {
  const result = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    env: {
      ...process.env,
      ...envObject
    }
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    const details = [result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join("\n");
    throw new Error(details || `Command failed: ${command}`);
  }
}

async function runCommandStreaming(command, envObject) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: true,
      env: {
        ...process.env,
        ...envObject
      }
    });

    const forwardSigint = () => {
      child.kill("SIGINT");
    };
    const forwardSigterm = () => {
      child.kill("SIGTERM");
    };

    process.once("SIGINT", forwardSigint);
    process.once("SIGTERM", forwardSigterm);

    const cleanup = () => {
      process.off("SIGINT", forwardSigint);
      process.off("SIGTERM", forwardSigterm);
    };

    child.on("error", (error) => {
      cleanup();
      reject(error);
    });

    child.on("exit", (code, signal) => {
      cleanup();

      if (signal) {
        reject(new Error(`Command terminated by signal ${signal}: ${command}`));
        return;
      }

      if ((code ?? 1) !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${command}`));
        return;
      }

      resolve(undefined);
    });
  });
}

export function getServiceName(row) {
  if (!row || typeof row !== "object") {
    return "";
  }

  return String(row.Service ?? row.service ?? "").trim();
}

export function getState(row) {
  if (!row || typeof row !== "object") {
    return "";
  }

  const directState = String(row.State ?? row.state ?? "").trim().toLowerCase();
  if (directState) {
    return directState;
  }

  const status = String(row.Status ?? row.status ?? "").trim().toLowerCase();
  if (!status) {
    return "";
  }

  if (status.startsWith("up")) {
    return "running";
  }

  return status;
}

export function getHealth(row) {
  if (!row || typeof row !== "object") {
    return "";
  }

  return String(row.Health ?? row.health ?? "").trim().toLowerCase();
}

export function shouldStartLocalStack(rows, requiredServices = localComposeServices) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return true;
  }

  const byService = new Map();
  for (const row of rows) {
    const service = getServiceName(row);
    if (service) {
      byService.set(service, row);
    }
  }

  for (const service of requiredServices) {
    const row = byService.get(service);
    if (!row) {
      return true;
    }

    const state = getState(row);
    if (!state.includes("running")) {
      return true;
    }

    const health = getHealth(row);
    if (health && health !== "healthy") {
      return true;
    }
  }

  return false;
}

export function isAuthFailureError(message) {
  if (typeof message !== "string") {
    return false;
  }

  const normalized = message.toLowerCase();
  return (
    normalized.includes("password authentication failed") ||
    normalized.includes("code: '28p01'") ||
    normalized.includes("auth_failed")
  );
}

function trimTrailingSlash(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\/+$/, "");
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

export function deriveDatabaseEnv(envObject, options = {}) {
  const normalized = { ...envObject };
  const user = normalized.POSTGRES_USER?.trim() || "ton";
  const database = normalized.POSTGRES_DB?.trim() || "ton_audit";
  const host = options.host ?? "localhost";
  const port = options.port ?? "5432";

  if (!hasNonEmptyValue(normalized.DB_PASSWORD)) {
    if (hasNonEmptyValue(normalized.POSTGRES_PASSWORD)) {
      normalized.DB_PASSWORD = normalized.POSTGRES_PASSWORD.trim();
    } else {
      const passwordFromUrl = extractPasswordFromDatabaseUrl(normalized.DATABASE_URL);
      if (passwordFromUrl) {
        normalized.DB_PASSWORD = passwordFromUrl;
      }
    }
  }

  if (!hasNonEmptyValue(normalized.POSTGRES_PASSWORD) && hasNonEmptyValue(normalized.DB_PASSWORD)) {
    normalized.POSTGRES_PASSWORD = normalized.DB_PASSWORD.trim();
  }

  if (!hasNonEmptyValue(normalized.DATABASE_URL) && hasNonEmptyValue(normalized.DB_PASSWORD)) {
    const encodedPassword = encodeURIComponent(normalized.DB_PASSWORD.trim());
    normalized.DATABASE_URL = `postgresql://${user}:${encodedPassword}@${host}:${port}/${database}`;
  }

  return normalized;
}

function toErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}

function parseProcessIdFromLockContent(content) {
  if (typeof content !== "string") {
    return null;
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const numericPid = Number.parseInt(trimmed, 10);
  if (Number.isInteger(numericPid) && numericPid > 0) {
    return numericPid;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const pidCandidate = Number.parseInt(
      String(parsed.pid ?? parsed.processId ?? parsed.processID ?? ""),
      10
    );
    if (Number.isInteger(pidCandidate) && pidCandidate > 0) {
      return pidCandidate;
    }
  } catch {
    // lock file is not JSON
  }

  return null;
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      return error.code === "EPERM";
    }
    return false;
  }
}

function isWebDevAlreadyRunning(webLockPath) {
  if (!fs.existsSync(webLockPath)) {
    return false;
  }

  try {
    const content = fs.readFileSync(webLockPath, "utf8");
    const pid = parseProcessIdFromLockContent(content);

    if (pid && isProcessAlive(pid)) {
      return true;
    }

    fs.unlinkSync(webLockPath);
    // eslint-disable-next-line no-console
    console.log(`Removed stale Next.js dev lock at ${webLockPath}`);
    return false;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = String(error.code ?? "");
      if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
        return true;
      }
    }

    // eslint-disable-next-line no-console
    console.warn(
      `Unable to inspect Next.js dev lock at ${webLockPath}. ` +
        `Assuming web dev is already running. Details: ${toErrorMessage(error)}`
    );
    return true;
  }
}

function removePathIfPresent(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (error) {
    throw new Error(`Failed to clear '${targetPath}': ${toErrorMessage(error)}`);
  }
}

export function resetNextDevArtifacts(workspaceRoot = process.cwd()) {
  const nextRoot = path.resolve(workspaceRoot, "apps", "web", ".next");
  const targets = [
    path.join(nextRoot, "cache"),
    path.join(nextRoot, "turbopack"),
    path.join(nextRoot, "dev", "cache"),
    path.join(nextRoot, "dev", "turbopack"),
    path.join(nextRoot, "dev", "lock")
  ];

  for (const target of targets) {
    removePathIfPresent(target);
  }

  return targets;
}

async function canReachHttpOk(url, timeoutMs = 1_500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateMinioCredentials(
  envObject,
  deps = {}
) {
  const endpoint = trimTrailingSlash(envObject.MINIO_ENDPOINT);
  const region = envObject.MINIO_REGION || "us-east-1";
  const bucket = envObject.MINIO_BUCKET;

  if (!endpoint || !bucket || !envObject.MINIO_ACCESS_KEY || !envObject.MINIO_SECRET_KEY) {
    throw new Error("Missing required MinIO credentials or endpoint configuration.");
  }

  const { S3Client, HeadBucketCommand } = deps.awsSdk
    ? deps.awsSdk
    : loadWorkspaceModule("@aws-sdk/client-s3");

  const client = deps.createClient
    ? deps.createClient({
        endpoint,
        forcePathStyle: true,
        region,
        credentials: {
          accessKeyId: envObject.MINIO_ACCESS_KEY,
          secretAccessKey: envObject.MINIO_SECRET_KEY
        }
      })
    : new S3Client({
        endpoint,
        forcePathStyle: true,
        region,
        credentials: {
          accessKeyId: envObject.MINIO_ACCESS_KEY,
          secretAccessKey: envObject.MINIO_SECRET_KEY
        }
      });

  const command = deps.createHeadBucketCommand
    ? deps.createHeadBucketCommand({ Bucket: bucket })
    : new HeadBucketCommand({ Bucket: bucket });

  try {
    await client.send(command);
  } catch (error) {
    const details = toErrorMessage(error);
    throw new Error(
      `MinIO credentials cannot access bucket '${bucket}'. ` +
        `Verify MINIO_ACCESS_KEY/MINIO_SECRET_KEY and bucket permissions. ` +
        `Details: ${details}`
    );
  }
}

export function getBuildEnv(envObject) {
  return {
    ...envObject,
    NODE_ENV: "production"
  };
}

function resetLocalPostgresVolume(envFile, envObject) {
  runCommand(
    `docker compose --env-file "${envFile}" -f docker-compose.yml down --volumes --remove-orphans`,
    envObject
  );
  runCommand(
    `docker compose --env-file "${envFile}" -f docker-compose.yml up -d --build --remove-orphans`,
    envObject
  );
}

async function waitForServiceReady(envFile, envObject, service, timeoutMs = 180_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const rows = getLocalStackRows(envFile, envObject);
    const row = rows.find((entry) => getServiceName(entry) === service);

    if (row) {
      const state = getState(row);
      const health = getHealth(row);
      const running = state.includes("running");
      const healthy = !health || health === "healthy";

      if (running && healthy) {
        return;
      }
    }

    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for service '${service}' to become healthy`);
}

function parseComposePsOutput(output) {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (parsed && typeof parsed === "object") {
      return [parsed];
    }
  } catch {
    const rows = [];
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim());
    for (const line of lines) {
      if (!line) {
        continue;
      }

      try {
        rows.push(JSON.parse(line));
      } catch {
        // ignore invalid line
      }
    }

    return rows;
  }

  return [];
}

function getLocalStackRows(envFile, envObject) {
  try {
    const output = runCommandCapture(
      `docker compose --env-file "${envFile}" -f docker-compose.yml ps --format json`,
      envObject
    );

    return parseComposePsOutput(output);
  } catch {
    return [];
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpOk(url, timeoutMs = 180_000) {
  const startedAt = Date.now();
  let lastError = "unknown";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for ${url} (${lastError})`);
}

async function waitForTonLspReady(url = "http://localhost:3002/health", timeoutMs = 180_000) {
  const startedAt = Date.now();
  let lastError = "unknown";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
      } else {
        const payload = await response.json().catch(() => null);
        if (!payload || typeof payload !== "object" || !("assetsReady" in payload)) {
          return;
        }

        if (payload.assetsReady === true) {
          return;
        }

        const missingAssets =
          Array.isArray(payload.missingAssets) && payload.missingAssets.length > 0
            ? payload.missingAssets.join(", ")
            : "unknown";
        lastError = `missing assets: ${missingAssets}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for TON LSP readiness at ${url} (${lastError})`);
}

function parseCliArgs(argv) {
  const envFlagIndex = argv.indexOf("--env-file");
  const serve = argv.includes("--serve");
  const quick = argv.includes("--quick");

  if (envFlagIndex >= 0) {
    const value = argv[envFlagIndex + 1];
    if (!value) {
      throw new Error("--env-file flag requires a value");
    }
    return {
      envFile: value,
      serve,
      quick
    };
  }

  return {
    envFile: ".env.local",
    serve,
    quick
  };
}

export async function runLocalDevPreflight(options = {}) {
  const envFile = options.envFile ?? ".env.local";
  const serve = options.serve === true;
  const quick = options.quick === true;
  const envFilePath = path.resolve(process.cwd(), envFile);
  const envFromFile = deriveDatabaseEnv(loadEnvFile(envFilePath), {
    host: "localhost",
    port: "5432"
  });

  const missingKeys = findMissingRequiredEnv(envFromFile);
  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required env values in ${envFile}: ${missingKeys.join(", ")}`
    );
  }

  for (const [key, value] of Object.entries(envFromFile)) {
    process.env[key] = value;
  }

  const dependenciesReady =
    canResolveWorkspaceModule("next/package.json") &&
    canResolveWorkspaceModule("@aws-sdk/client-s3");

  if (!quick || !dependenciesReady) {
    runCommand("pnpm install --frozen-lockfile", envFromFile);
  }
  runCommandCapture(`docker compose --env-file "${envFile}" -f docker-compose.yml config`, envFromFile);
  if (!quick) {
    runCommandCapture(`docker compose --env-file "${envFile}" -f docker-compose.prod.yml config`, envFromFile);
    runCommand("docker build -f apps/web/Dockerfile -t ton-audit-web:local-preflight .", envFromFile);
    runCommand("docker build -f apps/worker/Dockerfile -t ton-audit-worker:local-preflight .", envFromFile);
  }

  const stackRows = getLocalStackRows(envFile, envFromFile);
  if (shouldStartLocalStack(stackRows)) {
    runCommand(
      `docker compose --env-file "${envFile}" -f docker-compose.yml up -d --build --remove-orphans`,
      envFromFile
    );
  } else {
    // eslint-disable-next-line no-console
    console.log("Local compose stack already running and healthy; skipping docker compose up.");
  }

  await waitForServiceReady(envFile, envFromFile, "postgres");
  await waitForHttpOk(`${trimTrailingSlash(envFromFile.MINIO_ENDPOINT)}/minio/health/live`);
  await validateMinioCredentials(envFromFile);

  try {
    runCommand("pnpm db:migrate", envFromFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const recoveryReason = isAuthFailureError(message)
      ? "Detected Postgres auth mismatch."
      : "Migration failed before test phase.";

    // eslint-disable-next-line no-console
    console.log(`${recoveryReason} Recreating local compose volumes and retrying once.`);

    resetLocalPostgresVolume(envFile, envFromFile);
    await waitForServiceReady(envFile, envFromFile, "postgres");
    runCommand("pnpm db:migrate", envFromFile);
  }

  await waitForHttpOk("http://localhost:3003/health");
  await waitForTonLspReady("http://localhost:3002/health");

  if (!quick) {
    runCommand("pnpm lint", envFromFile);
    runCommand("pnpm typecheck", envFromFile);
    runCommand("pnpm test", envFromFile);
    runCommand("pnpm build", getBuildEnv(envFromFile));
  }

  if (serve) {
    // eslint-disable-next-line no-console
    console.log(
      quick
        ? "Quick dev bootstrap passed. Launching web + worker dev servers..."
        : "Preflight passed. Launching web + worker dev servers..."
    );

    const webLockPath = path.resolve(process.cwd(), "apps", "web", ".next", "dev", "lock");
    const webAlreadyRunning = isWebDevAlreadyRunning(webLockPath);
    const workerAlreadyRunning = await canReachHttpOk("http://localhost:3010/healthz");

    if (webAlreadyRunning && workerAlreadyRunning) {
      // eslint-disable-next-line no-console
      console.log("Web and worker dev servers are already running; nothing to start.");
      return;
    }

    const filters = [];
    const shouldStartWeb = !webAlreadyRunning;
    if (shouldStartWeb) {
      filters.push("--filter @ton-audit/web");
    }
    if (!workerAlreadyRunning) {
      filters.push("--filter @ton-audit/worker");
    }

    const serveCommand = `pnpm --parallel ${filters.join(" ")} dev`;
    try {
      await runCommandStreaming(serveCommand, envFromFile);
    } catch (error) {
      if (!shouldStartWeb) {
        throw error;
      }

      // eslint-disable-next-line no-console
      console.warn("Dev server startup failed. Clearing Next.js dev artifacts and retrying once.");
      const clearedTargets = resetNextDevArtifacts();
      // eslint-disable-next-line no-console
      console.warn(`Cleared: ${clearedTargets.join(", ")}`);

      const workerNowRunning = await canReachHttpOk("http://localhost:3010/healthz");
      const retryFilters = ["--filter @ton-audit/web"];
      if (!workerNowRunning) {
        retryFilters.push("--filter @ton-audit/worker");
      }

      const retryCommand = `pnpm --parallel ${retryFilters.join(" ")} dev`;
      await runCommandStreaming(retryCommand, envFromFile);
    }
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (invokedPath === currentFilePath) {
  const options = parseCliArgs(process.argv.slice(2));

  runLocalDevPreflight(options)
    .then(() => {
      // eslint-disable-next-line no-console
      console.log("Local dev preflight passed.");
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
