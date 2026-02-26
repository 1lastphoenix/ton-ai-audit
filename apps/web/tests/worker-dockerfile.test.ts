import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("worker dockerfile", () => {
  it("pins Playwright browser path and installs Chromium for PDF jobs", () => {
    const filePath = path.resolve(process.cwd(), "..", "..", "apps", "worker", "Dockerfile");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("FROM mcr.microsoft.com/playwright:v1.56.1-noble");
    expect(source).toContain("ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright");
    expect(source).toContain("ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1");
    expect(source).toContain(
      "RUN pnpm --filter @ton-audit/worker exec playwright install --with-deps chromium"
    );
  });
});
