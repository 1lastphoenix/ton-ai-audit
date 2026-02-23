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

export function toApiErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return jsonError(error.message, error.statusCode);
  }

  if (error instanceof Error) {
    return jsonError(error.message, 500);
  }

  return jsonError("Unknown server error", 500);
}
