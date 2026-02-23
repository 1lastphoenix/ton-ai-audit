import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("local docker compose dev services", () => {
  it("keeps compose infra-only so app and worker run via pnpm dev on host", () => {
    const composePath = path.resolve(process.cwd(), "..", "..", "docker-compose.yml");
    const compose = fs.readFileSync(composePath, "utf8");

    expect(compose).toMatch(/^  postgres:/m);
    expect(compose).toMatch(/^  redis:/m);
    expect(compose).toMatch(/^  minio:/m);
    expect(compose).toMatch(/^  sandbox-runner:/m);
    expect(compose).toMatch(/^  lsp-service:/m);

    expect(compose).not.toMatch(/^  web:/m);
    expect(compose).not.toMatch(/^  worker:/m);
  });
});
