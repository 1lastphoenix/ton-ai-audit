import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readDockerfileLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

describe("lsp service dockerfile", () => {
  it("uses Debian glibc base image and installs required build tooling", () => {
    const filePath = path.resolve(process.cwd(), "..", "..", "infra", "lsp-service", "Dockerfile");
    const source = fs.readFileSync(filePath, "utf8");
    const lines = readDockerfileLines(source);

    const fromLine = lines.find((line) => line.startsWith("FROM "));
    const aptInstallLine = lines.find((line) => line.includes("apt-get install -y --no-install-recommends"));

    expect(fromLine).toBe("FROM node:22-trixie-slim");
    expect(aptInstallLine).toBeDefined();
    expect(aptInstallLine).toContain("git");
    expect(aptInstallLine).toContain("ca-certificates");
    expect(aptInstallLine).toContain("curl");
  });

  it("pins ton-language-server to a commit SHA and verifies checkout", () => {
    const filePath = path.resolve(process.cwd(), "..", "..", "infra", "lsp-service", "Dockerfile");
    const source = fs.readFileSync(filePath, "utf8");

    const gitRefMatch = source.match(/ARG\s+TON_LSP_GIT_REF=([0-9a-f]{40})/i);
    expect(gitRefMatch?.[1]).toMatch(/^[0-9a-f]{40}$/);

    expect(source).toMatch(/git fetch --depth 1 origin "\$\{TON_LSP_GIT_REF\}"/);
    expect(source).toMatch(/test "\$\(git rev-parse HEAD\)" = "\$\{TON_LSP_GIT_REF\}"/);
    expect(source.includes("git clone --depth 1")).toBe(false);
    expect(source).toMatch(/RUN rm -rf \/opt\/ton-language-server\/.git/);
  });
});