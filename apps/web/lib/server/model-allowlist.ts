import { eq } from "drizzle-orm";
import { systemSettings } from "@ton-audit/shared";

import { assertAllowedModel } from "./model-allowlist-core";
import { db } from "./db";
import { env } from "./env";
export { assertAllowedModel };

export async function getAuditModelAllowlist() {
  const setting = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, "audit_model_allowlist")
  });

  const fromSetting = Array.isArray((setting?.value as { models?: unknown[] } | null)?.models)
    ? ((setting?.value as { models: unknown[] }).models ?? [])
        .map((item) => String(item).trim())
        .filter(Boolean)
    : [];

  return fromSetting.length ? fromSetting : env.AUDIT_MODEL_ALLOWLIST;
}
