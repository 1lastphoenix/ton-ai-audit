import { describe, expect, it } from "vitest";

import { auth, getAuthAdapterSchema, mapGitHubProfileToUser } from "../lib/server/auth";
import { dbSchema } from "@ton-audit/shared";

describe("server auth export", () => {
  it("exposes handler key for better-auth next handler wiring", () => {
    process.env.DATABASE_URL = "postgresql://ton:ton@localhost:5432/ton_audit";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.MINIO_ENDPOINT = "http://localhost:9000";
    process.env.MINIO_ACCESS_KEY = "minioadmin";
    process.env.MINIO_SECRET_KEY = "minioadmin";
    process.env.MINIO_BUCKET = "ton-audit";
    process.env.BETTER_AUTH_SECRET = "test-secret-0123456789abcdef012345";
    process.env.GITHUB_CLIENT_ID = "test-client-id";
    process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.OPENROUTER_EMBEDDINGS_MODEL = "openai/text-embedding-3-small";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    process.env.NEXT_PUBLIC_TON_LSP_WS_URL = "ws://localhost:3002";
    process.env.POSTGRES_PASSWORD = "ton";
    process.env.MINIO_ROOT_USER = "minioadmin";
    process.env.MINIO_ROOT_PASSWORD = "minioadmin";

    expect("handler" in auth).toBe(true);
  });

  it("exposes Better Auth verifications table in adapter schema", () => {
    const schema = getAuthAdapterSchema();
    expect(schema.verifications).toBe(dbSchema.verifications);
  });

  it("maps GitHub profiles without email to a deterministic fallback", () => {
    expect(mapGitHubProfileToUser({ id: 42, email: null })).toEqual({
      email: "github-42@users.noreply.github.com",
      emailVerified: false
    });

    expect(mapGitHubProfileToUser({ login: "OctoCat", email: "" })).toEqual({
      email: "octocat@users.noreply.github.com",
      emailVerified: false
    });
  });

  it("does not override provider email when GitHub returns one", () => {
    expect(mapGitHubProfileToUser({ email: "user@example.com", id: 1 })).toEqual({});
  });
});
