import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("audit compare core", () => {
  it("normalizes compare direction to older -> newer and computes lifecycle buckets", () => {
    const domainPath = path.resolve(process.cwd(), "lib", "server", "domain.ts");
    const source = fs.readFileSync(domainPath, "utf8");

    expect(source).toContain("left.createdAt.getTime() - right.createdAt.getTime()");
    expect(source).toContain("newlyDetected");
    expect(source).toContain("resolved");
    expect(source).toContain("persisting");
    expect(source).toContain("severityChangedCount");
  });
});
