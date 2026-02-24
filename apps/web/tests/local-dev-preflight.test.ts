import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const preflight = require("../../../scripts/local-dev-preflight.mjs") as {
  devServeCommand: string;
  isAuthFailureError: (message: string) => boolean;
  getState: (row: Record<string, string | undefined>) => string;
  getHealth: (row: Record<string, string | undefined>) => string;
  getServiceName: (row: Record<string, string | undefined>) => string;
  getBuildEnv: (envObject: Record<string, string>) => Record<string, string>;
  validateMinioCredentials: (
    envObject: Record<string, string>,
    deps?: {
      awsSdk?: { S3Client: unknown; HeadBucketCommand: unknown };
      createClient?: (config: Record<string, unknown>) => { send: (command: unknown) => Promise<unknown> };
      createHeadBucketCommand?: (input: { Bucket: string }) => unknown;
    }
  ) => Promise<void>;
  localComposeServices: string[];
  shouldStartLocalStack: (
    rows: Array<Record<string, string | undefined>>,
    requiredServices?: string[]
  ) => boolean;
  findMissingRequiredEnv: (envObject: Record<string, string>) => string[];
  parseDotEnv: (content: string) => Record<string, string>;
  requiredEnvKeys: string[];
  resetNextDevArtifacts: (workspaceRoot?: string) => string[];
};

const {
  devServeCommand,
  isAuthFailureError,
  getHealth,
  getServiceName,
  getBuildEnv,
  validateMinioCredentials,
  getState,
  shouldStartLocalStack,
  findMissingRequiredEnv,
  parseDotEnv,
  requiredEnvKeys,
  localComposeServices,
  resetNextDevArtifacts
} = preflight;

describe("local dev preflight env helpers", () => {
  it("parses dotenv-like content and ignores comments", () => {
    const parsed = parseDotEnv(`
# comment
DATABASE_URL=postgresql://ton:ton@localhost:5432/ton_audit
REDIS_URL=redis://localhost:6379
MINIO_BUCKET=ton-audit
`);

    expect(parsed.DATABASE_URL).toBe("postgresql://ton:ton@localhost:5432/ton_audit");
    expect(parsed.REDIS_URL).toBe("redis://localhost:6379");
    expect(parsed.MINIO_BUCKET).toBe("ton-audit");
  });

  it("flags missing and placeholder required env values", () => {
    const missing = findMissingRequiredEnv({
      DATABASE_URL: "postgresql://ton:ton@localhost:5432/ton_audit",
      REDIS_URL: "redis://localhost:6379",
      MINIO_ENDPOINT: "http://localhost:9000",
      MINIO_REGION: "us-east-1",
      MINIO_ACCESS_KEY: "replace-with-minio-access-key",
      MINIO_SECRET_KEY: "replace-with-minio-secret-key",
      MINIO_BUCKET: "ton-audit",
      BETTER_AUTH_SECRET: "replace-with-a-long-random-secret",
      GITHUB_CLIENT_ID: "",
      GITHUB_CLIENT_SECRET: "replace-with-github-oauth-client-secret",
      OPENROUTER_API_KEY: "replace-with-openrouter-api-key",
      OPENROUTER_EMBEDDINGS_MODEL: "openai/text-embedding-3-small",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_TON_LSP_WS_URL: "ws://localhost:3002",
      POSTGRES_PASSWORD: "replace-with-postgres-password",
      MINIO_ROOT_USER: "minioadmin",
      MINIO_ROOT_PASSWORD: "replace-with-minio-root-password"
    });

    expect(missing).toContain("MINIO_ACCESS_KEY");
    expect(missing).toContain("MINIO_SECRET_KEY");
    expect(missing).toContain("BETTER_AUTH_SECRET");
    expect(missing).toContain("GITHUB_CLIENT_ID");
    expect(missing).toContain("GITHUB_CLIENT_SECRET");
    expect(missing).toContain("OPENROUTER_API_KEY");
    expect(missing).toContain("POSTGRES_PASSWORD");
    expect(missing).toContain("MINIO_ROOT_PASSWORD");
    expect(missing).not.toContain("DATABASE_URL");
  });

  it("keeps required key list stable", () => {
    expect(requiredEnvKeys).toEqual(
      expect.arrayContaining([
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
      ])
    );
  });

  it("keeps local compose stack infra-only", () => {
    expect(localComposeServices).toEqual(
      expect.arrayContaining([
        "postgres",
        "redis",
        "minio",
        "sandbox-runner",
        "lsp-service"
      ])
    );
    expect(localComposeServices).not.toContain("web");
    expect(localComposeServices).not.toContain("worker");
  });

  it("forces NODE_ENV=production for build commands", () => {
    const buildEnv = getBuildEnv({
      NODE_ENV: "local",
      DATABASE_URL: "postgresql://ton:ton@localhost:5432/ton_audit"
    });

    expect(buildEnv.NODE_ENV).toBe("production");
    expect(buildEnv.DATABASE_URL).toBe("postgresql://ton:ton@localhost:5432/ton_audit");
  });

  it("keeps a single command to launch web and worker dev servers", () => {
    expect(devServeCommand).toContain("pnpm");
    expect(devServeCommand).toContain("@ton-audit/web");
    expect(devServeCommand).toContain("@ton-audit/worker");
  });

  it("skips compose up when all required services are running and healthy", () => {
    const result = shouldStartLocalStack(
      [
        { Service: "postgres", State: "running", Health: "healthy" },
        { Service: "redis", State: "running" },
        { Service: "minio", State: "running" },
        { Service: "sandbox-runner", State: "running", Health: "healthy" },
        { Service: "lsp-service", State: "running", Health: "healthy" },
        { Service: "web", State: "running" },
        { Service: "worker", State: "running", Health: "healthy" }
      ],
      ["postgres", "redis", "minio", "sandbox-runner", "lsp-service", "web", "worker"]
    );

    expect(result).toBe(false);
  });

  it("runs compose up when any required service is missing or unhealthy", () => {
    expect(
      shouldStartLocalStack(
        [
          { Service: "postgres", State: "running", Health: "healthy" },
          { Service: "redis", State: "running" },
          { Service: "minio", State: "running" },
          { Service: "sandbox-runner", State: "running", Health: "unhealthy" },
          { Service: "lsp-service", State: "running", Health: "healthy" },
          { Service: "web", State: "running" }
        ],
        ["postgres", "redis", "minio", "sandbox-runner", "lsp-service", "web", "worker"]
      )
    ).toBe(true);

    expect(shouldStartLocalStack([], ["postgres"])).toBe(true);
  });

  it("detects postgres auth failure signatures", () => {
    expect(isAuthFailureError("password authentication failed for user \"ton\"")).toBe(true);
    expect(isAuthFailureError("code: '28P01'")).toBe(true);
    expect(isAuthFailureError("connection timeout")).toBe(false);
  });

  it("normalizes compose row fields for state and health", () => {
    expect(getServiceName({ service: "postgres" })).toBe("postgres");
    expect(getState({ Status: "Up 8 seconds" })).toBe("running");
    expect(getHealth({ health: "healthy" })).toBe("healthy");
  });

  it("validates MinIO bucket access with configured credentials", async () => {
    const send = vi.fn().mockResolvedValue({});
    const createClient = vi.fn(() => ({ send }));
    const createHeadBucketCommand = vi.fn((input) => input);

    await validateMinioCredentials(
      {
        MINIO_ENDPOINT: "http://localhost:9000",
        MINIO_REGION: "us-east-1",
        MINIO_BUCKET: "ton-audit",
        MINIO_ACCESS_KEY: "minioadmin",
        MINIO_SECRET_KEY: "minioadmin"
      },
      {
        awsSdk: { S3Client: class {}, HeadBucketCommand: class {} },
        createClient,
        createHeadBucketCommand
      }
    );

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "http://localhost:9000",
        region: "us-east-1"
      })
    );
    expect(send).toHaveBeenCalledWith({ Bucket: "ton-audit" });
  });

  it("returns actionable MinIO errors when credentials cannot access bucket", async () => {
    const createClient = vi.fn(() => ({
      send: vi.fn().mockRejectedValue(new Error("InvalidAccessKeyId"))
    }));

    await expect(
      validateMinioCredentials(
        {
          MINIO_ENDPOINT: "http://localhost:9000",
          MINIO_REGION: "us-east-1",
          MINIO_BUCKET: "ton-audit",
          MINIO_ACCESS_KEY: "bad-key",
          MINIO_SECRET_KEY: "bad-secret"
        },
        {
          awsSdk: { S3Client: class {}, HeadBucketCommand: class {} },
          createClient,
          createHeadBucketCommand: (input) => input
        }
      )
    ).rejects.toThrow(/cannot access bucket/i);
  });

  it("clears Next.js dev artifacts used by Turbopack cache", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ton-audit-preflight-"));
    const nextRoot = path.join(tempRoot, "apps", "web", ".next");
    const cacheDir = path.join(nextRoot, "cache");
    const turboDir = path.join(nextRoot, "turbopack");
    const devCacheDir = path.join(nextRoot, "dev", "cache");
    const devTurboDir = path.join(nextRoot, "dev", "turbopack");
    const devLockPath = path.join(nextRoot, "dev", "lock");

    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(turboDir, { recursive: true });
    fs.mkdirSync(devCacheDir, { recursive: true });
    fs.mkdirSync(devTurboDir, { recursive: true });
    fs.mkdirSync(path.dirname(devLockPath), { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "data.bin"), "cache");
    fs.writeFileSync(path.join(devCacheDir, "data.bin"), "cache");
    fs.writeFileSync(devLockPath, String(process.pid));

    const clearedTargets = resetNextDevArtifacts(tempRoot);
    expect(clearedTargets).toEqual(
      expect.arrayContaining([cacheDir, turboDir, devCacheDir, devTurboDir, devLockPath])
    );

    expect(fs.existsSync(cacheDir)).toBe(false);
    expect(fs.existsSync(turboDir)).toBe(false);
    expect(fs.existsSync(devCacheDir)).toBe(false);
    expect(fs.existsSync(devTurboDir)).toBe(false);
    expect(fs.existsSync(devLockPath)).toBe(false);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
