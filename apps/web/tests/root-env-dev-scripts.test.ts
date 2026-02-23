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

  it("applies root env values after process env to avoid stale shell overrides", () => {
    const repoRoot = path.resolve(process.cwd(), "..", "..");
    const scriptPath = path.join(repoRoot, "scripts", "run-with-root-env.mjs");
    const source = fs.readFileSync(scriptPath, "utf8");

    expect(source).toMatch(/\.\.\.process\.env,\s*\.\.\.envFromRoot/s);
  });

  it("runs db scripts through the root env loader", () => {
    const repoRoot = path.resolve(process.cwd(), "..", "..");
    const webPackagePath = path.join(repoRoot, "apps", "web", "package.json");
    const webPackage = JSON.parse(fs.readFileSync(webPackagePath, "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(webPackage.scripts?.["db:generate"]).toContain("scripts/run-with-root-env.mjs");
    expect(webPackage.scripts?.["db:migrate"]).toContain("scripts/run-with-root-env.mjs");
    expect(webPackage.scripts?.["db:push"]).toContain("scripts/run-with-root-env.mjs");
  });
});
