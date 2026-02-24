import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("run audit route", () => {
  it("gates audit requests by project lifecycle state", () => {
    const routePath = path.resolve(
      process.cwd(),
      "app",
      "api",
      "projects",
      "[projectId]",
      "working-copies",
      "[workingCopyId]",
      "run-audit",
      "route.ts"
    );
    const source = fs.readFileSync(routePath, "utf8");

    expect(source).toContain("AUDIT_REQUESTABLE_PROJECT_STATES");
    expect(source).toContain("\"draft\"");
    expect(source).toContain("\"changes_pending\"");
    expect(source).toContain("project.lifecycleState");
    expect(source).toContain("status: 409");
  });

  it("blocks new audit requests while another audit is queued or running", () => {
    const routePath = path.resolve(
      process.cwd(),
      "app",
      "api",
      "projects",
      "[projectId]",
      "working-copies",
      "[workingCopyId]",
      "run-audit",
      "route.ts"
    );
    const source = fs.readFileSync(routePath, "utf8");

    expect(source).toContain("findActiveAuditRun");
    expect(source).toContain("An audit is already running for this project.");
    expect(source).toContain("activeAuditRunId");
    expect(source).toContain("status: 409");
  });
});
