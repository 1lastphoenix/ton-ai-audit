import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  checkRateLimit: vi.fn(),
  toApiErrorResponse: vi.fn((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }),
  ensureProjectAccess: vi.fn(),
  findAuditRunWithProject: vi.fn(),
  getPdfExportByAudit: vi.fn(),
  createPdfExport: vi.fn(),
  enqueueJob: vi.fn(),
  getJobs: vi.fn(),
  getObjectSignedUrl: vi.fn()
}));

vi.mock("@/lib/server/api", () => ({
  requireSession: mocks.requireSession,
  checkRateLimit: mocks.checkRateLimit,
  toApiErrorResponse: mocks.toApiErrorResponse
}));

vi.mock("@/lib/server/domain", () => ({
  ensureProjectAccess: mocks.ensureProjectAccess,
  findAuditRunWithProject: mocks.findAuditRunWithProject,
  getPdfExportByAudit: mocks.getPdfExportByAudit,
  createPdfExport: mocks.createPdfExport
}));

vi.mock("@/lib/server/queues", () => ({
  enqueueJob: mocks.enqueueJob,
  queues: {
    pdf: {
      getJobs: mocks.getJobs
    }
  }
}));

vi.mock("@/lib/server/s3", () => ({
  getObjectSignedUrl: mocks.getObjectSignedUrl
}));

import { GET as getPdfRoute, POST as postPdfRoute } from "../app/api/projects/[projectId]/audits/[auditId]/pdf/route";

describe("pdf export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.requireSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.checkRateLimit.mockResolvedValue(undefined);
    mocks.ensureProjectAccess.mockResolvedValue({ id: "project-1" });
    mocks.findAuditRunWithProject.mockResolvedValue({
      id: "audit-1",
      status: "completed",
      reportJson: { ok: true }
    });
    mocks.getPdfExportByAudit.mockResolvedValue(null);
    mocks.createPdfExport.mockResolvedValue({ id: "pdf-export-1", status: "queued" });
    mocks.enqueueJob.mockResolvedValue({ id: "pdf-job-1" });
    mocks.getJobs.mockResolvedValue([]);
    mocks.getObjectSignedUrl.mockResolvedValue("https://example.com/report.pdf");
  });

  it("enforces rate limiting and enqueues internal PDF variant", async () => {
    const response = await postPdfRoute(
      new Request("http://localhost/pdf", { method: "POST" }),
      {
        params: Promise.resolve({ projectId: "project-1", auditId: "audit-1" })
      }
    );

    expect(response.status).toBe(202);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("user-1", "export-pdf", 20, 600000);
    expect(mocks.createPdfExport).toHaveBeenCalledWith("audit-1", "internal");
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
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
    mocks.getPdfExportByAudit.mockResolvedValueOnce({
      id: "pdf-export-1",
      status: "running",
      s3Key: null,
      updatedAt: new Date()
    });
    mocks.getJobs.mockResolvedValueOnce([
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
    expect(mocks.createPdfExport).not.toHaveBeenCalled();
    expect(mocks.enqueueJob).not.toHaveBeenCalled();
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

    mocks.getPdfExportByAudit.mockResolvedValue({
      id: "pdf-export-1",
      status: "queued",
      s3Key: null,
      updatedAt: new Date(Date.now() - 60_000)
    });
    mocks.enqueueJob.mockResolvedValue({ id: "job-queued" });

    await postPdfRoute(new Request("http://localhost/pdf", { method: "POST" }), {
      params: Promise.resolve({ projectId: "project-1", auditId: "audit-1" })
    });

    await postPdfRoute(new Request("http://localhost/pdf", { method: "POST" }), {
      params: Promise.resolve({ projectId: "project-1", auditId: "audit-1" })
    });

    const jobIds = mocks.enqueueJob.mock.calls.map((call) => call[2] as string);
    expect(jobIds).toEqual([
      "pdf:project-1:audit-1:internal:uuid-1",
      "pdf:project-1:audit-1:internal:uuid-2"
    ]);

    uuidSpy.mockRestore();
  });

  it("returns signed download URL for completed exports", async () => {
    mocks.getPdfExportByAudit.mockResolvedValueOnce({
      id: "pdf-export-1",
      status: "completed",
      s3Key: "pdf/audit-1/final/report.pdf"
    });

    const response = await getPdfRoute(
      new Request("http://localhost/pdf"),
      {
        params: Promise.resolve({ projectId: "project-1", auditId: "audit-1" })
      }
    );

    expect(response.status).toBe(200);
    expect(mocks.getObjectSignedUrl).toHaveBeenCalledWith("pdf/audit-1/final/report.pdf", 600);
    await expect(response.json()).resolves.toEqual({
      status: "completed",
      variant: "internal",
      url: "https://example.com/report.pdf"
    });
  });
});