import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("ton workbench actions", () => {
  it("replaces upload panel with explorer context menu actions", () => {
    const filePath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "ton-workbench.tsx",
    );
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toMatch(/ContextMenu/);
    expect(source).toMatch(/New File/);
    expect(source).toMatch(/Upload Files/);
  });

  it("writes uploaded or created files into working copy API", () => {
    const filePath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "use-workbench-files.ts",
    );
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("working-copies/${activeWorkingCopyId}/file");
    expect(source).toContain("ensureWorkingCopy");
  });

  it("loads tree and file content from working copy when one is active", () => {
    const filePath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "use-workbench-files.ts",
    );
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("working-copies/${workingCopyId}/tree");
    expect(source).toContain("working-copies/${workingCopyId}/file?");
  });

  it("renders vscode-like tabs with close actions and keeps save shortcut in logic", () => {
    const filePath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "ton-workbench.tsx",
    );
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("closeOpenTab");
    expect(source).toContain("aria-label={`Close ${getFileName(path)}`}");
    expect(source).toContain("event.key.toLowerCase()");
    expect(source).toContain('normalizedKey === "s"');
  });

  it("uses one mode toggle button for edit and read-only", () => {
    const filePath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "ton-workbench.tsx",
    );
    const toolbarPath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "workbench-top-toolbar.tsx",
    );
    const source = fs.readFileSync(filePath, "utf8");
    const toolbarSource = fs.readFileSync(toolbarPath, "utf8");

    expect(source).toContain("toggleEditMode");
    expect(source).toContain("WorkbenchTopToolbar");
    expect(toolbarSource).toContain('props.isEditable ? "Read-only" : "Edit"');
  });

  it("clears file cache ref when revision or working copy context changes", () => {
    const filePath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "use-workbench-files.ts",
    );
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("fileCacheRef.current = {}");
    expect(source).toContain("}, [workingCopyId]);");
    expect(source).toContain("}, [revisionId]);");
  });

  it("keeps save on keyboard shortcut without a toolbar save button", () => {
    const filePath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "ton-workbench.tsx",
    );
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain('normalizedKey === "s"');
    expect(source).not.toContain("Ctrl/Cmd+S");
    expect(source).not.toMatch(/>\s*Save\s*<\/Button>/);
  });

  it("streams backend job events over SSE for the audit log", () => {
    const filePath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "use-workbench-events.ts",
    );
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("new EventSource(");
    expect(source).toContain(
      "/api/jobs/${encodeURIComponent(jobId)}/events?projectId=${projectId}",
    );
    expect(source).toContain("setRegisteredJobIds");
  });

  it("locks editing actions while audit is queued or running", () => {
    const filePath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "ton-workbench.tsx",
    );
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("isAuditWriteLocked");
    expect(source).toContain("readOnly: !isEditable || isAuditWriteLocked");
    expect(source).toContain(
      "Editing is disabled while an audit is queued or running.",
    );
  });

  it("renders verify per-step progress from SSE verify events", () => {
    const eventsPath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "use-workbench-events.ts",
    );
    const filePath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "ton-workbench.tsx",
    );
    const trackerPath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "workbench-execution-tracker.tsx",
    );
    const eventsSource = fs.readFileSync(eventsPath, "utf8");
    const source = fs.readFileSync(filePath, "utf8");
    const trackerSource = fs.readFileSync(trackerPath, "utf8");

    expect(eventsSource).toContain('payload.event === "progress"');
    expect(eventsSource).toContain('payload.event === "sandbox-step"');
    expect(source).toContain("verifyProgressPhaseLabel");
    expect(source).toContain("WorkbenchExecutionTracker");
    expect(trackerSource).toContain("Execution Tracker");
    expect(trackerSource).toContain("Verification Steps");
  });

  it("tracks audit phase progress in the same execution tracker", () => {
    const constantsPath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "ton-workbench.constants.ts",
    );
    const eventsPath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "use-workbench-events.ts",
    );
    const constantsSource = fs.readFileSync(constantsPath, "utf8");
    const eventsSource = fs.readFileSync(eventsPath, "utf8");

    expect(constantsSource).toContain("auditPipelineStageDefinitions");
    expect(constantsSource).toContain("agent-discovery");
    expect(constantsSource).toContain("agent-validation");
    expect(constantsSource).toContain("agent-synthesis");
    expect(eventsSource).toContain("report-quality-gate");
    expect(eventsSource).toContain("setAuditPipeline");
  });

  it("loads audit history, compares completed audits, and exports PDF per selected audit row", () => {
    const auditHookPath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "use-workbench-audit.ts",
    );
    const filePath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "ton-workbench.tsx",
    );
    const historyPath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "workbench-audit-history-list.tsx",
    );
    const constantsPath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "ton-workbench.constants.ts",
    );
    const auditHookSource = fs.readFileSync(auditHookPath, "utf8");
    const source = fs.readFileSync(filePath, "utf8");
    const historySource = fs.readFileSync(historyPath, "utf8");
    const constantsSource = fs.readFileSync(constantsPath, "utf8");

    expect(auditHookSource).toContain("/api/projects/${projectId}/audits");
    expect(auditHookSource).toContain("/api/projects/${projectId}/audits/compare?");
    expect(constantsSource).toContain("Audit History");
    expect(auditHookSource).toContain("exportPdfForAudit");
    expect(source).toContain("WorkbenchAuditHistoryList");
    expect(historySource).toContain("Download Paper");
  });

  it("keeps audit profile selector in context menu only and removes schema/engine chips from cards", () => {
    const filePath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "ton-workbench.tsx",
    );
    const historyPath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "workbench-audit-history-list.tsx",
    );
    const toolbarPath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "workbench-top-toolbar.tsx",
    );
    const source = fs.readFileSync(filePath, "utf8");
    const historySource = fs.readFileSync(historyPath, "utf8");
    const toolbarSource = fs.readFileSync(toolbarPath, "utf8");

    expect(source).toContain("WorkbenchTopToolbar");
    expect(toolbarSource).toContain("Audit profile (");
    expect(source).not.toContain("<Select value={auditProfile}");
    expect(historySource).not.toContain("schema v");
    expect(historySource).not.toContain("legacy-engine");
  });

  it("falls back to Monaco language highlighting for ts/js/md style files", () => {
    const constantsPath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "ton-workbench.constants.ts",
    );
    const utilsPath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "ton-workbench.utils.ts",
    );
    const constantsSource = fs.readFileSync(constantsPath, "utf8");
    const utilsSource = fs.readFileSync(utilsPath, "utf8");

    expect(constantsSource).toContain('".ts": "typescript"');
    expect(constantsSource).toContain('".js": "javascript"');
    expect(constantsSource).toContain('".md": "markdown"');
    expect(utilsSource).toContain("resolveMonacoLanguage");
  });

  it("deduplicates model options before rendering selector items", () => {
    const filePath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "workbench-top-toolbar.tsx",
    );
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("normalizeModelAllowlist");
    expect(source).toContain(
      "const modelOptions = normalizeModelAllowlist(props.modelAllowlist)",
    );
  });

  it("extracts findings tab body into dedicated component", () => {
    const filePath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "ton-workbench.tsx",
    );
    const findingsPath = path.resolve(
      process.cwd(),
      "components",
      "workbench",
      "workbench-findings-panel.tsx",
    );
    const source = fs.readFileSync(filePath, "utf8");
    const findingsSource = fs.readFileSync(findingsPath, "utf8");

    expect(source).toContain("WorkbenchFindingsPanel");
    expect(findingsSource).toContain("Search findings, summaries, or files");
    expect(findingsSource).toContain("No findings match your current filters.");
  });
});
