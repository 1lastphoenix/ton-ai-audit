import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class ActiveAuditRunConflictError extends Error {
    activeAuditRunId: string | null;

    constructor(activeAuditRunId: string | null) {
      super("An audit is already running for this project.");
      this.name = "ActiveAuditRunConflictError";
      this.activeAuditRunId = activeAuditRunId;
    }
  }

  return {
    ActiveAuditRunConflictError,
    requireSession: vi.fn(),
    checkRateLimit: vi.fn(),
    parseJsonBody: vi.fn(),
    toApiErrorResponse: vi.fn((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown";
      return Response.json({ error: message }, { status: 500 });
    }),
    ensureProjectAccess: vi.fn(),
    findActiveAuditRun: vi.fn(),
    snapshotWorkingCopyAndCreateAuditRun: vi.fn(),
    getAuditModelAllowlist: vi.fn(),
    assertAllowedModel: vi.fn(),
    enqueueJob: vi.fn()
  };
});

vi.mock("@/lib/server/api", () => ({
  requireSession: mocks.requireSession,
  checkRateLimit: mocks.checkRateLimit,
  parseJsonBody: mocks.parseJsonBody,
  toApiErrorResponse: mocks.toApiErrorResponse
}));

vi.mock("@/lib/server/domain", () => ({
  ActiveAuditRunConflictError: mocks.ActiveAuditRunConflictError,
  ensureProjectAccess: mocks.ensureProjectAccess,
  findActiveAuditRun: mocks.findActiveAuditRun,
  snapshotWorkingCopyAndCreateAuditRun: mocks.snapshotWorkingCopyAndCreateAuditRun
}));

vi.mock("@/lib/server/model-allowlist", () => ({
  getAuditModelAllowlist: mocks.getAuditModelAllowlist,
  assertAllowedModel: mocks.assertAllowedModel
}));

vi.mock("@/lib/server/queues", () => ({
  enqueueJob: mocks.enqueueJob
}));

import { POST as runAuditRoute } from "../app/api/projects/[projectId]/working-copies/[workingCopyId]/run-audit/route";

describe("run-audit route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.requireSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.checkRateLimit.mockResolvedValue(undefined);
    mocks.parseJsonBody.mockResolvedValue({
      primaryModelId: "google/gemini-2.5-flash",
      fallbackModelId: "google/gemini-2.5-flash",
      profile: "deep",
      includeDocsFallbackFetch: true
    });
    mocks.getAuditModelAllowlist.mockResolvedValue(["google/gemini-2.5-flash"]);
    mocks.assertAllowedModel.mockReturnValue(undefined);
    mocks.ensureProjectAccess.mockResolvedValue({ id: "project-1", lifecycleState: "ready" });
    mocks.findActiveAuditRun.mockResolvedValue(null);
    mocks.snapshotWorkingCopyAndCreateAuditRun.mockResolvedValue({
      revision: { id: "revision-1" },
      auditRun: { id: "audit-1" }
    });
    mocks.enqueueJob.mockResolvedValue({ id: "verify-job-1" });
  });

  it("rejects audit requests for non-requestable project lifecycle states", async () => {
    mocks.ensureProjectAccess.mockResolvedValueOnce({
      id: "project-1",
      lifecycleState: "initializing"
    });

    const response = await runAuditRoute(
      new Request("http://localhost/run-audit", { method: "POST" }),
      {
        params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
      }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Audit requests are not allowed while project state is 'initializing'."
    });
  });

  it("returns active audit metadata when another audit is already queued or running", async () => {
    mocks.findActiveAuditRun.mockResolvedValueOnce({ id: "audit-existing" });

    const response = await runAuditRoute(
      new Request("http://localhost/run-audit", { method: "POST" }),
      {
        params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
      }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "An audit is already running for this project.",
      activeAuditRunId: "audit-existing"
    });
    expect(mocks.snapshotWorkingCopyAndCreateAuditRun).not.toHaveBeenCalled();
  });

  it("queues verify stage after creating revision and audit run snapshot", async () => {
    const response = await runAuditRoute(
      new Request("http://localhost/run-audit", { method: "POST" }),
      {
        params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
      }
    );

    expect(response.status).toBe(200);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("user-1", "run-audit", 10, 600000);
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      "verify",
      expect.objectContaining({
        projectId: "project-1",
        revisionId: "revision-1",
        auditRunId: "audit-1",
        profile: "deep"
      }),
      "verify:project-1:audit-1"
    );

    await expect(response.json()).resolves.toEqual({
      revision: { id: "revision-1" },
      auditRun: { id: "audit-1" },
      verifyJobId: "verify-job-1"
    });
  });

  it("maps domain conflict errors to 409 conflict responses", async () => {
    mocks.snapshotWorkingCopyAndCreateAuditRun.mockRejectedValueOnce(
      new mocks.ActiveAuditRunConflictError("audit-race")
    );

    const response = await runAuditRoute(
      new Request("http://localhost/run-audit", { method: "POST" }),
      {
        params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
      }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "An audit is already running for this project.",
      activeAuditRunId: "audit-race"
    });
  });
});