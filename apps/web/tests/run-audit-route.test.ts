import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/api", async () => {
  const fixture = await import("./fixtures/server-api-mocks");
  return fixture.serverApiMockModule;
});

vi.mock("@/lib/server/domain", async () => {
  const fixture = await import("./fixtures/server-domain-mocks");
  return fixture.serverDomainMockModule;
});

vi.mock("@/lib/server/model-allowlist", async () => {
  const fixture = await import("./fixtures/server-model-allowlist-mocks");
  return fixture.serverModelAllowlistMockModule;
});

vi.mock("@/lib/server/queues", async () => {
  const fixture = await import("./fixtures/server-queues-mocks");
  return fixture.serverQueuesMockModule;
});

import {
  applyDefaultServerApiMocks,
  resetServerApiMocks,
  serverApiMocks
} from "./fixtures/server-api-mocks";
import {
  ActiveAuditRunConflictError,
  resetServerDomainMocks,
  serverDomainMocks
} from "./fixtures/server-domain-mocks";
import {
  resetServerModelAllowlistMocks,
  serverModelAllowlistMocks
} from "./fixtures/server-model-allowlist-mocks";
import {
  resetServerQueuesMocks,
  serverQueuesMocks
} from "./fixtures/server-queues-mocks";
import { POST as runAuditRoute } from "../app/api/projects/[projectId]/working-copies/[workingCopyId]/run-audit/route";

describe("run-audit route", () => {
  beforeEach(() => {
    resetServerApiMocks();
    resetServerDomainMocks();
    resetServerModelAllowlistMocks();
    resetServerQueuesMocks();

    applyDefaultServerApiMocks("user-1");
    serverApiMocks.parseJsonBody.mockResolvedValue({
      primaryModelId: "google/gemini-2.5-flash",
      fallbackModelId: "google/gemini-2.5-flash",
      profile: "deep",
      includeDocsFallbackFetch: true
    });

    serverModelAllowlistMocks.getAuditModelAllowlist.mockResolvedValue([
      "google/gemini-2.5-flash"
    ]);
    serverModelAllowlistMocks.assertAllowedModel.mockReturnValue(undefined);

    serverDomainMocks.ensureProjectAccess.mockResolvedValue({
      id: "project-1",
      lifecycleState: "ready"
    });
    serverDomainMocks.findActiveAuditRun.mockResolvedValue(null);
    serverDomainMocks.snapshotWorkingCopyAndCreateAuditRun.mockResolvedValue({
      revision: { id: "revision-1" },
      auditRun: { id: "audit-1" }
    });

    serverQueuesMocks.enqueueJob.mockResolvedValue({ id: "verify-job-1" });
  });

  it("rejects audit requests for non-requestable project lifecycle states", async () => {
    serverDomainMocks.ensureProjectAccess.mockResolvedValueOnce({
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
    serverDomainMocks.findActiveAuditRun.mockResolvedValueOnce({
      id: "audit-existing"
    });

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
    expect(
      serverDomainMocks.snapshotWorkingCopyAndCreateAuditRun
    ).not.toHaveBeenCalled();
  });

  it("queues verify stage after creating revision and audit run snapshot", async () => {
    const response = await runAuditRoute(
      new Request("http://localhost/run-audit", { method: "POST" }),
      {
        params: Promise.resolve({ projectId: "project-1", workingCopyId: "wc-1" })
      }
    );

    expect(response.status).toBe(200);
    expect(serverApiMocks.checkRateLimit).toHaveBeenCalledWith(
      "user-1",
      "run-audit",
      10,
      600000
    );
    expect(serverQueuesMocks.enqueueJob).toHaveBeenCalledWith(
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
    serverDomainMocks.snapshotWorkingCopyAndCreateAuditRun.mockRejectedValueOnce(
      new ActiveAuditRunConflictError("audit-race")
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
