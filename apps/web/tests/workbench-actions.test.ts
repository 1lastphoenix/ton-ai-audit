import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("ton workbench actions", () => {
  it("replaces upload panel with explorer context menu actions", () => {
    const filePath = path.resolve(process.cwd(), "components", "workbench", "ton-workbench.tsx");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toMatch(/ContextMenu/);
    expect(source).toMatch(/New File/);
    expect(source).toMatch(/Upload Files/);
  });

  it("writes uploaded or created files into working copy API", () => {
    const filePath = path.resolve(process.cwd(), "components", "workbench", "ton-workbench.tsx");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("working-copies/${activeWorkingCopyId}/file");
    expect(source).toContain("ensureWorkingCopy");
  });

  it("renders vscode-like tabs with close actions and keeps save shortcut in logic", () => {
    const filePath = path.resolve(process.cwd(), "components", "workbench", "ton-workbench.tsx");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("closeOpenTab");
    expect(source).toContain("aria-label={`Close ${getFileName(path)}`}");
    expect(source).toContain("event.key.toLowerCase()");
    expect(source).toContain("normalizedKey === \"s\"");
  });

  it("uses one mode toggle button for edit and read-only", () => {
    const filePath = path.resolve(process.cwd(), "components", "workbench", "ton-workbench.tsx");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("toggleEditMode");
    expect(source).toContain("isEditable ? \"Read-only\" : \"Edit\"");
  });

  it("keeps save on keyboard shortcut without a toolbar save button", () => {
    const filePath = path.resolve(process.cwd(), "components", "workbench", "ton-workbench.tsx");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("normalizedKey === \"s\"");
    expect(source).not.toContain("Ctrl/Cmd+S");
    expect(source).not.toMatch(/>\s*Save\s*<\/Button>/);
  });

  it("streams backend job events over SSE for the audit log", () => {
    const filePath = path.resolve(process.cwd(), "components", "workbench", "ton-workbench.tsx");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("new EventSource(");
    expect(source).toContain("/api/jobs/${encodeURIComponent(jobId)}/events?projectId=${projectId}");
    expect(source).toContain("setActiveJobIds");
  });
});
