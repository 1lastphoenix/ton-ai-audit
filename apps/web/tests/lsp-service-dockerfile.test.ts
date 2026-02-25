import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("lsp service dockerfile", () => {
  it("uses a glibc-compatible base and installs curl for grammar wasm generation", () => {
    const filePath = path.resolve(process.cwd(), "..", "..", "infra", "lsp-service", "Dockerfile");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("FROM node:22-trixie-slim");
    expect(source).toContain("apt-get install -y --no-install-recommends git ca-certificates curl");
  });

  it("pins ton-language-server to an explicit git ref", () => {
    const filePath = path.resolve(process.cwd(), "..", "..", "infra", "lsp-service", "Dockerfile");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toMatch(/ARG TON_LSP_GIT_REF=[0-9a-f]{40}/);
    expect(source).toContain("git fetch --depth 1 origin \"${TON_LSP_GIT_REF}\"");
    expect(source).toContain("test \"$(git rev-parse HEAD)\" = \"${TON_LSP_GIT_REF}\"");
    expect(source).not.toContain("git clone --depth 1 https://github.com/ton-blockchain/ton-language-server.git");
    expect(source).toContain("RUN rm -rf /opt/ton-language-server/.git");
  });
});
