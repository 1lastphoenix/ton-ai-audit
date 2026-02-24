import { eq } from "drizzle-orm";
import { systemSettings } from "@ton-audit/shared";

import { assertAllowedModel } from "./model-allowlist-core";
import { db } from "./db";
import { env } from "./env";
export { assertAllowedModel };

// TTL cache so every audit request does not hit the database.
const CACHE_TTL_MS = 30_000;
let cachedAllowlist: string[] | null = null;
let cacheExpiresAt = 0;

export async function getAuditModelAllowlist(): Promise<string[]> {
  const now = Date.now();
  if (cachedAllowlist && now < cacheExpiresAt) {
    return cachedAllowlist;
  }

  const setting = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, "audit_model_allowlist")
  });

  const fromSetting = Array.isArray((setting?.value as { models?: unknown[] } | null)?.models)
    ? ((setting?.value as { models: unknown[] }).models ?? [])
        .map((item) => String(item).trim())
        .filter(Boolean)
    : [];

  const result = fromSetting.length ? fromSetting : env.AUDIT_MODEL_ALLOWLIST;

  cachedAllowlist = result;
  cacheExpiresAt = now + CACHE_TTL_MS;

  return result;
}
