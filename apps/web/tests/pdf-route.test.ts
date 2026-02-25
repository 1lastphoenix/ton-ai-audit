import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("pdf export route", () => {
  it("enforces rate limiting and cooldown checks for export requests", () => {
    const routePath = path.resolve(
      process.cwd(),
      "app",
      "api",
      "projects",
      "[projectId]",
      "audits",
      "[auditId]",
      "pdf",
      "route.ts"
    );
    const source = fs.readFileSync(routePath, "utf8");

    expect(source).toContain("checkRateLimit");
    expect(source).toContain("\"export-pdf\"");
    expect(source).toContain("PDF_ENQUEUE_COOLDOWN_MS");
  });

  it("heals stale queued states by checking real in-flight queue jobs", () => {
    const routePath = path.resolve(
      process.cwd(),
      "app",
      "api",
      "projects",
      "[projectId]",
      "audits",
      "[auditId]",
      "pdf",
      "route.ts"
    );
    const source = fs.readFileSync(routePath, "utf8");

    expect(source).toContain("findInFlightPdfJob");
    expect(source).toContain("queues.pdf.getJobs");
    expect(source).toContain("job.data.projectId");
    expect(source).toContain("job.data.auditRunId");
  });

  it("uses unique BullMQ job ids for each requeue attempt", () => {
    const routePath = path.resolve(
      process.cwd(),
      "app",
      "api",
      "projects",
      "[projectId]",
      "audits",
      "[auditId]",
      "pdf",
      "route.ts"
    );
    const source = fs.readFileSync(routePath, "utf8");

    expect(source).toContain("crypto.randomUUID()");
    expect(source).toContain("const uniqueJobId");
  });
});
