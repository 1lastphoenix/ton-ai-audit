import { envConfigSchema, parseModelAllowlist } from "@ton-audit/shared";

const parsed = envConfigSchema.safeParse(process.env);

if (!parsed.success) {
  const issueText = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid environment configuration: ${issueText}`);
}

export const env = {
  ...parsed.data,
  AUDIT_MODEL_ALLOWLIST: parseModelAllowlist(parsed.data.AUDIT_MODEL_ALLOWLIST)
};