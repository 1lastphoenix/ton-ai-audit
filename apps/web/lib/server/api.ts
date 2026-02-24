import { NextResponse } from "next/server";
import { ZodSchema } from "zod";

import { auth } from "./auth";

export class ApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function parseJsonBody<T>(request: Request, schema: ZodSchema<T>) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    throw new ApiError("Invalid JSON request body", 400);
  }

  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiError(parsed.error.issues.map((issue) => issue.message).join("; "), 400);
  }

  return parsed.data;
}

export async function requireSession(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    throw new ApiError("Unauthorized", 401);
  }

  return session;
}

function getPgErrorCode(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function getPgConstraint(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const constraint = (error as { constraint?: unknown }).constraint;
  return typeof constraint === "string" ? constraint : null;
}

function getErrorCode(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function getAwsErrorName(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

function getAwsErrorStatusCode(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const metadata = (error as { $metadata?: unknown }).$metadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const statusCode = (metadata as { httpStatusCode?: unknown }).httpStatusCode;
  return typeof statusCode === "number" ? statusCode : null;
}

function isStorageAuthError(error: unknown) {
  const awsName = getAwsErrorName(error);
  const code = getErrorCode(error);
  return (
    awsName === "SignatureDoesNotMatch" ||
    awsName === "InvalidAccessKeyId" ||
    awsName === "AccessDenied" ||
    code === "SignatureDoesNotMatch" ||
    code === "InvalidAccessKeyId" ||
    code === "AccessDenied"
  );
}

function isStorageUnavailableError(error: unknown) {
  const statusCode = getAwsErrorStatusCode(error);
  if (statusCode !== null && [408, 425, 429, 500, 502, 503, 504].includes(statusCode)) {
    return true;
  }

  const awsName = getAwsErrorName(error);
  return (
    awsName === "TimeoutError" ||
    awsName === "NetworkingError" ||
    awsName === "RequestTimeout" ||
    awsName === "ServiceUnavailable"
  );
}

export function toApiErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return jsonError(error.message, error.statusCode);
  }

  const code = getPgErrorCode(error);
  if (code === "23505") {
    const constraint = getPgConstraint(error);
    if (
      constraint === "projects_owner_slug_unique" ||
      constraint === "projects_owner_slug_active_unique"
    ) {
      return jsonError("A project with this slug already exists for your account.", 409);
    }

    return jsonError("Resource already exists.", 409);
  }

  if (
    error instanceof Error &&
    "statusCode" in error &&
    typeof (error as { statusCode?: unknown }).statusCode === "number"
  ) {
    return jsonError(error.message, (error as { statusCode: number }).statusCode);
  }

  if (isStorageAuthError(error)) {
    return jsonError("Object storage authentication failed. Check MinIO credentials.", 503);
  }

  if (isStorageUnavailableError(error)) {
    return jsonError("Object storage is unavailable. Please retry.", 503);
  }

  if (error instanceof Error) {
    return jsonError(error.message, 500);
  }

  return jsonError("Unknown server error", 500);
}
