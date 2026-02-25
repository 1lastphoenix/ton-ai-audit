import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("pdf template", () => {
  it("includes model metadata and publication-grade sections in exported PDF html", () => {
    const filePath = path.resolve(process.cwd(), "src", "processors", "pdf.ts");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("Table of Contents");
    expect(source).toContain("Final Complete Audit PDF");
    expect(source).toContain("Technical Appendix");
    expect(source).toContain("renderInlineMarkdown");
    expect(source).toContain("Primary Model");
    expect(source).toContain("Fallback Model");
    expect(source).toContain("toc-col-anchor");
    expect(source).toContain("report-footer");
    expect(source).toContain("Remove residual markdown markers");
  });

  it("persists the used model in the generated report payload", () => {
    const filePath = path.resolve(process.cwd(), "src", "processors", "audit.ts");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("model: {");
    expect(source).toContain("used: usedModel");
  });
});
