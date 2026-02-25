import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/api", async () => {
  const fixture = await import("./fixtures/server-api-mocks");
  return fixture.serverApiMockModule;
});

vi.mock("@/lib/server/domain", async () => {
  const fixture = await import("./fixtures/server-domain-mocks");
  return fixture.serverDomainMockModule;
});

vi.mock("@/lib/server/queues", async () => {
  const fixture = await import("./fixtures/server-queues-mocks");
  return fixture.serverQueuesMockModule;
});

vi.mock("@/lib/server/s3", async () => {
  const fixture = await import("./fixtures/server-s3-mocks");
  return fixture.serverS3MockModule;
});

import {
  applyDefaultServerApiMocks,
  resetServerApiMocks,
  serverApiMocks
} from "./fixtures/server-api-mocks";
import {
  resetServerDomainMocks,
  serverDomainMocks
} from "./fixtures/server-domain-mocks";
import {
  resetServerQueuesMocks,
  serverQueuesMocks
} from "./fixtures/server-queues-mocks";
import { resetServerS3Mocks, serverS3Mocks } from "./fixtures/server-s3-mocks";
import {
  GET as getPdfRoute,
  POST as postPdfRoute
} from "../app/api/projects/[projectId]/audits/[auditId]/pdf/route";

describe("pdf export route", () => {
  beforeEach(() => {
    resetServerApiMocks();
    resetServerDomainMocks();
    resetServerQueuesMocks();
    resetServerS3Mocks();

    applyDefaultServerApiMocks("user-1");

    serverDomainMocks.ensureProjectAccess.mockResolvedValue({ id: "project-1" });
    serverDomainMocks.findAuditRunWithProject.mockResolvedValue({
      id: "audit-1",
      status: "completed",
      reportJson: { ok: true }
    });
    serverDomainMocks.getPdfExportByAudit.mockResolvedValue(null);
    serverDomainMocks.createPdfExport.mockResolvedValue({
      id: "pdf-export-1",
      status: "queued"
    });

    serverQueuesMocks.enqueueJob.mockResolvedValue({ id: "pdf-job-1" });
    serverQueuesMocks.getPdfJobs.mockResolvedValue([]);
    serverS3Mocks.getObjectSignedUrl.mockResolvedValue(
      "https://example.com/report.pdf"
    );
  });

  it("enforces rate limiting and enqueues internal PDF variant", async () => {
    const response = await postPdfRoute(
      new Request("http://localhost/pdf", { method: "POST" }),
      {
        params: Promise.resolve({ projectId: "project-1", auditId: "audit-1" })
      }
    );

    expect(response.status).toBe(202);
    expect(serverApiMocks.checkRateLimit).toHaveBeenCalledWith(
      "user-1",
      "export-pdf",
      20,
      600000
    );
    expect(serverDomainMocks.createPdfExport).toHaveBeenCalledWith(
      "audit-1",
      "internal"
    );
    expect(serverQueuesMocks.enqueueJob).toHaveBeenCalledWith(
      "pdf",
      expect.objectContaining({
        projectId: "project-1",
        auditRunId: "audit-1",
        variant: "internal",
        requestedByUserId: "user-1"
      }),
      expect.stringMatching(/^pdf:project-1:audit-1:internal:/)
    );

    await expect(response.json()).resolves.toEqual({
      jobId: "pdf-job-1",
      status: "queued",
      queued: true,
      variant: "internal"
    });
  });

  it("returns in-flight queue metadata instead of duplicating work", async () => {
    serverDomainMocks.getPdfExportByAudit.mockResolvedValueOnce({
      id: "pdf-export-1",
      status: "running",
      s3Key: null,
      updatedAt: new Date()
    });
    serverQueuesMocks.getPdfJobs.mockResolvedValueOnce([
      {
        id: "job-in-flight",
        data: {
          projectId: "project-1",
          auditRunId: "audit-1"
        }
      }
    ]);

    const response = await postPdfRoute(
      new Request("http://localhost/pdf", { method: "POST" }),
      {
        params: Promise.resolve({ projectId: "project-1", auditId: "audit-1" })
      }
    );

    expect(response.status).toBe(202);
    expect(serverDomainMocks.createPdfExport).not.toHaveBeenCalled();
    expect(serverQueuesMocks.enqueueJob).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      jobId: "job-in-flight",
      status: "running",
      queued: false,
      variant: "internal"
    });
  });

  it("uses unique BullMQ job IDs for each requeue attempt", async () => {
    const uuidSpy = vi.spyOn(globalThis.crypto, "randomUUID");
    uuidSpy.mockReturnValueOnce("uuid-1").mockReturnValueOnce("uuid-2");

    serverDomainMocks.getPdfExportByAudit.mockResolvedValue({
      id: "pdf-export-1",
      status: "queued",
      s3Key: null,
      updatedAt: new Date(Date.now() - 60_000)
    });
    serverQueuesMocks.enqueueJob.mockResolvedValue({ id: "job-queued" });

    await postPdfRoute(new Request("http://localhost/pdf", { method: "POST" }), {
      params: Promise.resolve({ projectId: "project-1", auditId: "audit-1" })
    });

    await postPdfRoute(new Request("http://localhost/pdf", { method: "POST" }), {
      params: Promise.resolve({ projectId: "project-1", auditId: "audit-1" })
    });

    const jobIds = serverQueuesMocks.enqueueJob.mock.calls.map(
      (call) => call[2] as string
    );
    expect(jobIds).toEqual([
      "pdf:project-1:audit-1:internal:uuid-1",
      "pdf:project-1:audit-1:internal:uuid-2"
    ]);

    uuidSpy.mockRestore();
  });

  it("returns signed download URL for completed exports", async () => {
    serverDomainMocks.getPdfExportByAudit.mockResolvedValueOnce({
      id: "pdf-export-1",
      status: "completed",
      s3Key: "pdf/audit-1/final/report.pdf"
    });

    const response = await getPdfRoute(new Request("http://localhost/pdf"), {
      params: Promise.resolve({ projectId: "project-1", auditId: "audit-1" })
    });

    expect(response.status).toBe(200);
    expect(serverS3Mocks.getObjectSignedUrl).toHaveBeenCalledWith(
      "pdf/audit-1/final/report.pdf",
      600
    );
    await expect(response.json()).resolves.toEqual({
      status: "completed",
      variant: "internal",
      url: "https://example.com/report.pdf"
    });
  });
});
