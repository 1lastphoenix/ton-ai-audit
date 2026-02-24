import { describe, expect, it } from "vitest";

import { toApiErrorResponse } from "../lib/server/api";

describe("API error response mapping", () => {
  it("maps duplicate project slug constraint violations to conflict", async () => {
    const pgError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "projects_owner_slug_unique"
    });

    const response = toApiErrorResponse(pgError);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "A project with this slug already exists for your account."
    });
  });

  it("maps storage auth errors to service unavailable", async () => {
    const storageError = Object.assign(new Error("The request signature we calculated does not match"), {
      name: "SignatureDoesNotMatch"
    });

    const response = toApiErrorResponse(storageError);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Object storage authentication failed. Check MinIO credentials."
    });
  });

  it("maps storage transient errors to service unavailable", async () => {
    const storageError = Object.assign(new Error("Service unavailable"), {
      name: "ServiceUnavailable",
      $metadata: {
        httpStatusCode: 503
      }
    });

    const response = toApiErrorResponse(storageError);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Object storage is unavailable. Please retry."
    });
  });
});
