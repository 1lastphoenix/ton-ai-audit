import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("ingest failure lifecycle handling", () => {
  it("does not auto-delete projects when ingest fails", () => {
    const sourcePath = path.resolve(process.cwd(), "src", "processors", "ingest.ts");
    const source = fs.readFileSync(sourcePath, "utf8");

    const catchStart = source.lastIndexOf("} catch (error) {");
    const failedEvent = source.indexOf("await recordJobEvent", catchStart);

    expect(catchStart).toBeGreaterThan(0);
    expect(failedEvent).toBeGreaterThan(catchStart);

    const failureBlock = source.slice(catchStart, failedEvent);
    expect(failureBlock).toContain("status: \"failed\"");
    expect(failureBlock).toContain("lifecycleState: \"ready\"");
    expect(failureBlock).toContain("deletedAt: null");
    expect(failureBlock).toContain("eq(projects.lifecycleState, \"initializing\")");
    expect(failureBlock).not.toContain("lifecycleState: \"deleted\"");
    expect(failureBlock).not.toContain("deletedAt: new Date()");
  });
});
