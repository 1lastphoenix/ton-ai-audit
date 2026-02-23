import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("dev scripts use root env loader", () => {
  it("routes web and worker dev scripts through run-with-root-env", () => {
    const repoRoot = path.resolve(process.cwd(), "..", "..");
    const webPackagePath = path.join(repoRoot, "apps", "web", "package.json");
    const workerPackagePath = path.join(repoRoot, "apps", "worker", "package.json");

    const webPackage = JSON.parse(fs.readFileSync(webPackagePath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const workerPackage = JSON.parse(fs.readFileSync(workerPackagePath, "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(webPackage.scripts?.dev).toContain("scripts/run-with-root-env.mjs");
    expect(workerPackage.scripts?.dev).toContain("scripts/run-with-root-env.mjs");
  });
});
