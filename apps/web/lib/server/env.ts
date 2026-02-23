import { type z } from "zod";

import { envConfigSchema, parseModelAllowlist } from "@ton-audit/shared";

type ParsedEnv = Omit<z.infer<typeof envConfigSchema>, "AUDIT_MODEL_ALLOWLIST"> & {
  AUDIT_MODEL_ALLOWLIST: string[];
};

let cachedEnv: ParsedEnv | null = null;

export function getEnv(): ParsedEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envConfigSchema.safeParse(process.env);

  if (!parsed.success) {
    const issueText = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid environment configuration: ${issueText}`);
  }

  cachedEnv = {
    ...parsed.data,
    AUDIT_MODEL_ALLOWLIST: parseModelAllowlist(parsed.data.AUDIT_MODEL_ALLOWLIST)
  };

  return cachedEnv;
}

function bindIfFunction<T extends object>(instance: T, value: unknown) {
  if (typeof value === "function") {
    return value.bind(instance);
  }

  return value;
}

export const env = new Proxy({} as ParsedEnv, {
  get(_target, property) {
    const instance = getEnv();
    const value = Reflect.get(instance, property, instance);
    return bindIfFunction(instance, value);
  }
});
