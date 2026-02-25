import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("working copy tree route", () => {
  it("serves tree data from working_copy_files for authorized users", () => {
    const routePath = path.resolve(
      process.cwd(),
      "app",
      "api",
      "projects",
      "[projectId]",
      "working-copies",
      "[workingCopyId]",
      "tree",
      "route.ts"
    );
    const source = fs.readFileSync(routePath, "utf8");

    expect(source).toContain("ensureWorkingCopyAccess");
    expect(source).toContain("workingCopyFiles");
    expect(source).toContain("buildFileTree");
  });
});
