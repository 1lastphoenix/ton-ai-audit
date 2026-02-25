import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  parseJsonBody: vi.fn(),
  toApiErrorResponse: vi.fn((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }),
  ensureProjectAccess: vi.fn(),
  ensureWorkingCopyAccess: vi.fn(),
  findActiveAuditRun: vi.fn(),
  saveWorkingCopyFile: vi.fn(),
  dbSelectLimit: vi.fn(),
  dbSelectWhere: vi.fn(),
  dbSelectFrom: vi.fn(),
  dbSelect: vi.fn()
}));

mocks.dbSelect.mockImplementation(() => ({
  from: mocks.dbSelectFrom
}));

mocks.dbSelectFrom.mockImplementation(() => ({
  where: mocks.dbSelectWhere
}));

mocks.dbSelectWhere.mockImplementation(() => ({
  limit: mocks.dbSelectLimit
}));

vi.mock("@/lib/server/api", () => ({
  requireSession: mocks.requireSession,
  parseJsonBody: mocks.parseJsonBody,
  toApiErrorResponse: mocks.toApiErrorResponse
}));

vi.mock("@/lib/server/domain", () => ({
  ensureProjectAccess: mocks.ensureProjectAccess,
  ensureWorkingCopyAccess: mocks.ensureWorkingCopyAccess,
  findActiveAuditRun: mocks.findActiveAuditRun,
  saveWorkingCopyFile: mocks.saveWorkingCopyFile
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    select: mocks.dbSelect
  }
}));

import { GET as getWorkingCopyFileRoute, PATCH as patchWorkingCopyFileRoute } from "../app/api/projects/[projectId]/working-copies/[workingCopyId]/file/route";

describe("working copy file route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.requireSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.ensureProjectAccess.mockResolvedValue({ id: "project-1" });
    mocks.ensureWorkingCopyAccess.mockResolvedValue({ id: "wc-1" });
    mocks.findActiveAuditRun.mockResolvedValue(null);
    mocks.parseJsonBody.mockResolvedValue({
      path: "contracts/main.tolk",
      content: "fun main() {}",
      language: "tolk"
    });
    mocks.saveWorkingCopyFile.mockResolvedValue({
      path: "contracts/main.tolk",
      content: "fun main() {}",
      language: "tolk"
    });
  });

  it("blocks PATCH writes while an audit is queued or running", async () => {
    mocks.findActiveAuditRun.mockResolvedValueOnce({ id: "audit-1" });

    const response = await patchWorkingCopyFileRoute(
      new Request("http://localhost/file", { method: "PATCH" }),
      {
        params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
      }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Cannot modify files while an audit is running for this project.",
      activeAuditRunId: "audit-1"
    });
    expect(mocks.saveWorkingCopyFile).not.toHaveBeenCalled();
  });

  it("validates GET query and returns 400 when file path is missing", async () => {
    const response = await getWorkingCopyFileRoute(
      new Request("http://localhost/file"),
      {
        params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
      }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Missing file path" });
  });

  it("returns 404 when the requested file does not exist", async () => {
    mocks.dbSelectLimit.mockResolvedValueOnce([]);

    const response = await getWorkingCopyFileRoute(
      new Request("http://localhost/file?path=contracts/main.tolk"),
      {
        params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
      }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "File not found" });
  });

  it("returns file payload for valid working-copy reads", async () => {
    const file = {
      path: "contracts/main.tolk",
      language: "tolk",
      content: "fun main() {}"
    };
    mocks.dbSelectLimit.mockResolvedValueOnce([file]);

    const response = await getWorkingCopyFileRoute(
      new Request("http://localhost/file?path=contracts/main.tolk"),
      {
        params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ file });
  });
});