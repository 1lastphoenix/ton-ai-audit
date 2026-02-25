class ModelAllowlistError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ModelAllowlistError";
    this.statusCode = statusCode;
  }
}

function normalizedAllowlist(allowlist: string[]) {
  return new Set(allowlist.map((model) => model.trim()).filter(Boolean));
}

export function assertAllowedModel(modelId: string, allowlist: string[]) {
  const candidates = normalizedAllowlist(allowlist);
  if (!candidates.has(modelId)) {
    throw new ModelAllowlistError(
      `Model '${modelId}' is not in the configured allowlist`,
      400
    );
  }
}
