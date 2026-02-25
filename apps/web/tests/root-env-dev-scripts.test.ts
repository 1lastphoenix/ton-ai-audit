import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

type PackageJson = {
  scripts?: Record<string, string>;
};

function readJson<T>(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

describe("run-with-root-env usage", () => {
  it("routes web and worker dev/db scripts through root env loader", () => {
    const repoRoot = path.resolve(process.cwd(), "..", "..");
    const webPackage = readJson<PackageJson>(path.join(repoRoot, "apps", "web", "package.json"));
    const workerPackage = readJson<PackageJson>(path.join(repoRoot, "apps", "worker", "package.json"));

    const webScripts = webPackage.scripts ?? {};
    const workerScripts = workerPackage.scripts ?? {};

    expect(webScripts.dev).toMatch(/^node\s+\.\.\/\.\.\/scripts\/run-with-root-env\.mjs\s+--\s+/);
    expect(workerScripts.dev).toMatch(/^node\s+\.\.\/\.\.\/scripts\/run-with-root-env\.mjs\s+--\s+/);
    expect(webScripts["db:generate"]).toMatch(/^node\s+\.\.\/\.\.\/scripts\/run-with-root-env\.mjs\s+--\s+/);
    expect(webScripts["db:migrate"]).toMatch(/^node\s+\.\.\/\.\.\/scripts\/run-with-root-env\.mjs\s+--\s+/);
    expect(webScripts["db:push"]).toMatch(/^node\s+\.\.\/\.\.\/scripts\/run-with-root-env\.mjs\s+--\s+/);
  });

  it("prefers root env values over inherited process env", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "root-env-loader-"));
    const scriptsDir = path.join(tempRoot, "scripts");
    fs.mkdirSync(scriptsDir, { recursive: true });

    const sourceScript = path.resolve(process.cwd(), "..", "..", "scripts", "run-with-root-env.mjs");
    const tempScript = path.join(scriptsDir, "run-with-root-env.mjs");
    const probeScript = path.join(tempRoot, "print-priority.cjs");
    fs.copyFileSync(sourceScript, tempScript);
    fs.writeFileSync(path.join(tempRoot, ".env.local"), "TEST_PRIORITY=from-root\n");
    fs.writeFileSync(probeScript, "process.stdout.write(process.env.TEST_PRIORITY ?? '');\n");

    const output = execFileSync(
      process.execPath,
      [tempScript, "--", process.execPath, probeScript],
      {
        cwd: tempRoot,
        env: {
          ...process.env,
          TEST_PRIORITY: "from-process"
        },
        encoding: "utf8"
      }
    ).trim();

    expect(output).toBe("from-root");

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("derives DATABASE_URL and POSTGRES_PASSWORD from DB_PASSWORD when needed", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "root-env-loader-db-"));
    const scriptsDir = path.join(tempRoot, "scripts");
    fs.mkdirSync(scriptsDir, { recursive: true });

    const sourceScript = path.resolve(process.cwd(), "..", "..", "scripts", "run-with-root-env.mjs");
    const tempScript = path.join(scriptsDir, "run-with-root-env.mjs");
    const probeScript = path.join(tempRoot, "print-db-env.cjs");
    fs.copyFileSync(sourceScript, tempScript);

    fs.writeFileSync(
      path.join(tempRoot, ".env.local"),
      [
        "DB_PASSWORD=top-secret",
        "POSTGRES_USER=ton",
        "POSTGRES_DB=ton_audit"
      ].join("\n")
    );
    fs.writeFileSync(
      probeScript,
      "process.stdout.write(JSON.stringify({ db: process.env.DB_PASSWORD, pg: process.env.POSTGRES_PASSWORD, url: process.env.DATABASE_URL }));\n"
    );

    const output = execFileSync(
      process.execPath,
      [tempScript, "--", process.execPath, probeScript],
      {
        cwd: tempRoot,
        env: process.env,
        encoding: "utf8"
      }
    ).trim();

    const parsed = JSON.parse(output) as {
      db?: string;
      pg?: string;
      url?: string;
    };

    expect(parsed.db).toBe("top-secret");
    expect(parsed.pg).toBe("top-secret");
    expect(parsed.url).toBe("postgresql://ton:top-secret@localhost:5432/ton_audit");

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
