import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("pdf template", () => {
  it("includes model metadata and product footer in exported PDF html", () => {
    const filePath = path.resolve(process.cwd(), "src", "processors", "pdf.ts");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("AI/LLM Model Used");
    expect(source).toContain("audit.circulo.cloud");
    expect(source).toContain("Primary Model");
    expect(source).toContain("Fallback Model");
  });

  it("persists the used model in the generated report payload", () => {
    const filePath = path.resolve(process.cwd(), "src", "processors", "audit.ts");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("model: {");
    expect(source).toContain("used: usedModel");
  });
});
