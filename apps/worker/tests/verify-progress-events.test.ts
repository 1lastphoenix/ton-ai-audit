import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("verify processor progress events", () => {
  it("emits structured verify progress and sandbox step events", () => {
    const filePath = path.resolve(process.cwd(), "src", "processors", "verify.ts");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("event: \"progress\"");
    expect(source).toContain("phase: \"plan-ready\"");
    expect(source).toContain("phase: \"sandbox-running\"");
    expect(source).toContain("phase: \"sandbox-completed\"");
    expect(source).toContain("event: \"sandbox-step\"");
  });
});
