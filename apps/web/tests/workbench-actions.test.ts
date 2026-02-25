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

  it("loads tree and file content from working copy when one is active", () => {
    const filePath = path.resolve(process.cwd(), "components", "workbench", "ton-workbench.tsx");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("working-copies/${workingCopyId}/tree");
    expect(source).toContain("working-copies/${workingCopyId}/file?");
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

  it("clears file cache ref when revision or working copy context changes", () => {
    const filePath = path.resolve(process.cwd(), "components", "workbench", "ton-workbench.tsx");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("fileCacheRef.current = {}");
    expect(source).toContain("}, [workingCopyId]);");
    expect(source).toContain("}, [revisionId]);");
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

  it("locks editing actions while audit is queued or running", () => {
    const filePath = path.resolve(process.cwd(), "components", "workbench", "ton-workbench.tsx");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("isAuditWriteLocked");
    expect(source).toContain("readOnly: !isEditable || isAuditWriteLocked");
    expect(source).toContain("Editing is disabled while an audit is queued or running.");
  });

  it("renders verify per-step progress from SSE verify events", () => {
    const filePath = path.resolve(process.cwd(), "components", "workbench", "ton-workbench.tsx");
    const trackerPath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "workbench-execution-tracker.tsx",
    );
    const source = fs.readFileSync(filePath, "utf8");
    const trackerSource = fs.readFileSync(trackerPath, "utf8");

    expect(source).toContain("event === \"progress\"");
    expect(source).toContain("event === \"sandbox-step\"");
    expect(source).toContain("verifyProgressPhaseLabel");
    expect(source).toContain("WorkbenchExecutionTracker");
    expect(trackerSource).toContain("Execution Tracker");
    expect(trackerSource).toContain("Verification Steps");
  });

  it("tracks audit phase progress in the same execution tracker", () => {
    const filePath = path.resolve(process.cwd(), "components", "workbench", "ton-workbench.tsx");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("auditPipelineStageDefinitions");
    expect(source).toContain("agent-discovery");
    expect(source).toContain("agent-validation");
    expect(source).toContain("agent-synthesis");
    expect(source).toContain("report-quality-gate");
    expect(source).toContain("setAuditPipeline");
  });

  it("loads audit history, compares completed audits, and exports PDF per selected audit row", () => {
    const filePath = path.resolve(process.cwd(), "components", "workbench", "ton-workbench.tsx");
    const historyPath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "workbench-audit-history-list.tsx",
    );
    const source = fs.readFileSync(filePath, "utf8");
    const historySource = fs.readFileSync(historyPath, "utf8");

    expect(source).toContain("/api/projects/${projectId}/audits");
    expect(source).toContain("/api/projects/${projectId}/audits/compare?");
    expect(source).toContain("Audit History");
    expect(source).toContain("exportPdfForAudit");
    expect(source).toContain("WorkbenchAuditHistoryList");
    expect(historySource).toContain("Final PDF");
  });

  it("keeps audit profile selector in context menu only and removes schema/engine chips from cards", () => {
    const filePath = path.resolve(process.cwd(), "components", "workbench", "ton-workbench.tsx");
    const historyPath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "workbench-audit-history-list.tsx",
    );
    const source = fs.readFileSync(filePath, "utf8");
    const historySource = fs.readFileSync(historyPath, "utf8");

    expect(source).toContain("Audit profile (");
    expect(source).not.toContain("<Select value={auditProfile}");
    expect(historySource).not.toContain("schema v");
    expect(historySource).not.toContain("legacy-engine");
  });

  it("falls back to Monaco language highlighting for ts/js/md style files", () => {
    const filePath = path.resolve(process.cwd(), "components", "workbench", "ton-workbench.tsx");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain('".ts": "typescript"');
    expect(source).toContain('".js": "javascript"');
    expect(source).toContain('".md": "markdown"');
    expect(source).toContain("resolveMonacoLanguage");
  });

  it("deduplicates model options before rendering selector items", () => {
    const filePath = path.resolve(process.cwd(), "components", "workbench", "ton-workbench.tsx");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("normalizeModelAllowlist");
    expect(source).toContain("const modelOptions = normalizeModelAllowlist(props.modelAllowlist)");
  });
});
