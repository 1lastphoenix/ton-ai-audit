#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const requiredEnvKeys = [
  "DATABASE_URL",
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
  "POSTGRES_PASSWORD",
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

function toErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
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
    : await import("@aws-sdk/client-s3");

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

  if (envFlagIndex >= 0) {
    const value = argv[envFlagIndex + 1];
    if (!value) {
      throw new Error("--env-file flag requires a value");
    }
    return {
      envFile: value,
      serve
    };
  }

  return {
    envFile: ".env.local",
    serve
  };
}

export async function runLocalDevPreflight(options = {}) {
  const envFile = options.envFile ?? ".env.local";
  const serve = options.serve === true;
  const envFilePath = path.resolve(process.cwd(), envFile);
  const envFromFile = loadEnvFile(envFilePath);

  const missingKeys = findMissingRequiredEnv(envFromFile);
  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required env values in ${envFile}: ${missingKeys.join(", ")}`
    );
  }

  for (const [key, value] of Object.entries(envFromFile)) {
    process.env[key] = value;
  }

  runCommand("pnpm install --frozen-lockfile", envFromFile);
  runCommandCapture(`docker compose --env-file "${envFile}" -f docker-compose.yml config`, envFromFile);
  runCommandCapture(`docker compose --env-file "${envFile}" -f docker-compose.prod.yml config`, envFromFile);
  runCommand("docker build -f apps/web/Dockerfile -t ton-audit-web:local-preflight .", envFromFile);
  runCommand("docker build -f apps/worker/Dockerfile -t ton-audit-worker:local-preflight .", envFromFile);

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

  runCommand("pnpm lint", envFromFile);
  runCommand("pnpm typecheck", envFromFile);
  runCommand("pnpm test", envFromFile);
  runCommand("pnpm build", getBuildEnv(envFromFile));

  if (serve) {
    // eslint-disable-next-line no-console
    console.log("Preflight passed. Launching web + worker dev servers...");
    runCommand(devServeCommand, envFromFile);
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
