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
});
