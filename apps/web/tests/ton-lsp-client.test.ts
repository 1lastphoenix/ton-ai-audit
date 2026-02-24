import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("ton lsp client bootstrap", () => {
  it("loads browser-only lsp modules lazily to avoid SSR window errors", () => {
    const filePath = path.resolve(process.cwd(), "lib", "editor", "ton-lsp-client.ts");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain('import("monaco-languageclient")');
    expect(source).toContain('import("monaco-languageclient/vscodeApiWrapper")');
    expect(source).not.toContain('from "monaco-languageclient";');
  });

  it("registers fallback tolk syntax highlighting rules", () => {
    const filePath = path.resolve(process.cwd(), "lib", "editor", "ton-lsp-client.ts");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("setMonarchTokensProvider(\"tolk\"");
    expect(source).toContain("setLanguageConfiguration(\"tolk\"");
  });

  it("guards shutdown during failed initialization to avoid stop-state races", () => {
    const filePath = path.resolve(process.cwd(), "lib", "editor", "ton-lsp-client.ts");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("if (typeof client.isRunning === \"function\" && !client.isRunning())");
    expect(source).toContain("await client.start()");
  });
});
