import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/api", async () => {
  const fixture = await import("./fixtures/server-api-mocks");
  return fixture.serverApiMockModule;
});

vi.mock("@/lib/server/domain", async () => {
  const fixture = await import("./fixtures/server-domain-mocks");
  return fixture.serverDomainMockModule;
});

import {
  applyDefaultServerApiMocks,
  resetServerApiMocks
} from "./fixtures/server-api-mocks";
import {
  resetServerDomainMocks,
  serverDomainMocks
} from "./fixtures/server-domain-mocks";
import { GET as getAuditsRoute } from "../app/api/projects/[projectId]/audits/route";
import { GET as getAuditCompareRoute } from "../app/api/projects/[projectId]/audits/compare/route";

describe("audits routes", () => {
  beforeEach(() => {
    resetServerApiMocks();
    resetServerDomainMocks();

    applyDefaultServerApiMocks("user-1");
    serverDomainMocks.ensureProjectAccess.mockResolvedValue({
      id: "project-1",
      lifecycleState: "ready"
    });
    serverDomainMocks.queryProjectAuditHistory.mockResolvedValue([]);
    serverDomainMocks.getAuditComparison.mockResolvedValue({ kind: "not-found" });
  });

  it("returns 404 when project access is denied for audit history", async () => {
    serverDomainMocks.ensureProjectAccess.mockResolvedValueOnce(null);

    const response = await getAuditsRoute(new Request("http://localhost/audits"), {
      params: Promise.resolve({ projectId: "project-1" })
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Project not found" });
  });

  it("returns project audit history for authorized users", async () => {
    const audits = [{ id: "audit-1" }, { id: "audit-2" }];
    serverDomainMocks.queryProjectAuditHistory.mockResolvedValueOnce(audits);

    const response = await getAuditsRoute(new Request("http://localhost/audits"), {
      params: Promise.resolve({ projectId: "project-1" })
    });

    expect(response.status).toBe(200);
    expect(serverDomainMocks.queryProjectAuditHistory).toHaveBeenCalledWith("project-1");
    await expect(response.json()).resolves.toEqual({ audits });
  });

  it("validates compare query parameters", async () => {
    const missingParamsResponse = await getAuditCompareRoute(
      new Request("http://localhost/compare"),
      { params: Promise.resolve({ projectId: "project-1" }) }
    );

    expect(missingParamsResponse.status).toBe(400);
    await expect(missingParamsResponse.json()).resolves.toEqual({
      error: "Both fromAuditId and toAuditId query parameters are required."
    });

    const sameParamsResponse = await getAuditCompareRoute(
      new Request("http://localhost/compare?fromAuditId=a-1&toAuditId=a-1"),
      { params: Promise.resolve({ projectId: "project-1" }) }
    );

    expect(sameParamsResponse.status).toBe(400);
    await expect(sameParamsResponse.json()).resolves.toEqual({
      error: "fromAuditId and toAuditId must be different audit runs."
    });
  });

  it("returns 409 when comparison targets are not completed", async () => {
    serverDomainMocks.getAuditComparison.mockResolvedValueOnce({
      kind: "not-completed",
      fromStatus: "running",
      toStatus: "completed"
    });

    const response = await getAuditCompareRoute(
      new Request("http://localhost/compare?fromAuditId=a-1&toAuditId=a-2"),
      { params: Promise.resolve({ projectId: "project-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Both audits must be completed before comparison (from=running, to=completed)."
    });
  });

  it("returns normalized comparison payload when comparison succeeds", async () => {
    const comparison = {
      fromAudit: {
        id: "a-old",
        revisionId: "r-old",
        createdAt: "2026-01-01T00:00:00.000Z",
        findingCount: 1
      },
      toAudit: {
        id: "a-new",
        revisionId: "r-new",
        createdAt: "2026-01-02T00:00:00.000Z",
        findingCount: 2
      },
      summary: {
        findings: {
          fromTotal: 1,
          toTotal: 2,
          newCount: 1,
          resolvedCount: 0,
          persistingCount: 1,
          severityChangedCount: 0
        },
        files: {
          addedCount: 1,
          removedCount: 0,
          unchangedCount: 1
        }
      },
      findings: {
        newlyDetected: [],
        resolved: [],
        persisting: []
      },
      files: {
        added: ["contracts/new.tolk"],
        removed: [],
        unchanged: ["contracts/shared.tolk"]
      }
    };

    serverDomainMocks.getAuditComparison.mockResolvedValueOnce({
      kind: "ok",
      comparison
    });

    const response = await getAuditCompareRoute(
      new Request("http://localhost/compare?fromAuditId=a-1&toAuditId=a-2"),
      { params: Promise.resolve({ projectId: "project-1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(comparison);
    expect(serverDomainMocks.getAuditComparison).toHaveBeenCalledWith({
      projectId: "project-1",
      fromAuditId: "a-1",
      toAuditId: "a-2"
    });
  });
});
