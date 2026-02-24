import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("working copy file route", () => {
  it("blocks file writes while a project audit is queued or running", () => {
    const routePath = path.resolve(
      process.cwd(),
      "app",
      "api",
      "projects",
      "[projectId]",
      "working-copies",
      "[workingCopyId]",
      "file",
      "route.ts"
    );
    const source = fs.readFileSync(routePath, "utf8");

    expect(source).toContain("findActiveAuditRun");
    expect(source).toContain("Cannot modify files while an audit is running for this project.");
    expect(source).toContain("activeAuditRunId");
    expect(source).toContain("status: 409");
  });
});
