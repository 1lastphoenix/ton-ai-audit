import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/workbench/ton-workbench.constants", () => ({
  auditPipelineStageDefinitions: [
    { id: "verify-plan", label: "Verification Plan", description: "" },
    { id: "security-scans", label: "Security Scans", description: "" },
    { id: "sandbox-checks", label: "Sandbox Checks", description: "" },
    { id: "agent-discovery", label: "Agent Discovery", description: "" },
    { id: "agent-validation", label: "Agent Validation", description: "" },
    { id: "agent-synthesis", label: "Agent Synthesis", description: "" },
    { id: "quality-gate", label: "Report Quality Gate", description: "" }
  ],
  languageMap: {
    tolk: "tolk",
    func: "func",
    tact: "tact",
    fift: "fift",
    "tl-b": "tl-b",
    unknown: "plaintext"
  },
  extensionLanguageMap: {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".md": "markdown",
    ".markdown": "markdown",
    ".json": "json",
    ".xml": "xml"
  }
}));

import {
  buildLspWebSocketUrls,
  canExportAuditPdf,
  createIdleAuditPipeline,
  finalizeAuditPipeline,
  normalizeModelAllowlist,
  parseVerifyProgressSteps,
  resolveMonacoLanguage,
  summarizeVerifyProgress,
  updateAuditPipelineStage,
  verifyProgressPhaseLabel
} from "../components/workbench/ton-workbench.utils";

describe("workbench runtime behaviors", () => {
  it("deduplicates model allowlist entries while preserving first-seen order", () => {
    expect(
      normalizeModelAllowlist([
        " google/gemini-2.5-flash ",
        "google/gemini-2.5-flash",
        "anthropic/claude-sonnet-4",
        "",
        "anthropic/claude-sonnet-4"
      ])
    ).toEqual(["google/gemini-2.5-flash", "anthropic/claude-sonnet-4"]);
  });

  it("resolves Monaco language from canonical language first, then extension fallback", () => {
    expect(
      resolveMonacoLanguage({
        filePath: "contracts/main.tolk",
        language: "tolk"
      })
    ).toBe("tolk");

    expect(
      resolveMonacoLanguage({
        filePath: "tests/main.spec.ts",
        language: "unknown"
      })
    ).toBe("typescript");

    expect(
      resolveMonacoLanguage({
        filePath: "README.md",
        language: undefined
      })
    ).toBe("markdown");
  });

  it("normalizes verify progress steps and summarizes terminal counts", () => {
    const steps = parseVerifyProgressSteps([
      { id: "scan", action: "security-rules-scan", status: "completed", timeoutMs: 1_000 },
      { id: "sandbox", action: "blueprint-build", status: "failed", timeoutMs: 5_000, durationMs: 4120 },
      { action: "lint", status: "skipped" },
      { id: "invalid", status: "not-a-state" }
    ]);

    expect(steps).toHaveLength(4);
    expect(steps[2]).toMatchObject({
      id: "step-3",
      action: "lint",
      status: "skipped"
    });
    expect(steps[3]).toMatchObject({
      id: "invalid",
      status: "pending"
    });

    expect(summarizeVerifyProgress(steps)).toEqual({
      completed: 1,
      failed: 1,
      skipped: 1,
      timeout: 0
    });
  });

  it("tracks audit pipeline stages and finalizes fast profile with validation skipped", () => {
    let pipeline = createIdleAuditPipeline("fast");

    pipeline = updateAuditPipelineStage(pipeline, {
      stageId: "verify-plan",
      status: "running"
    });

    pipeline = updateAuditPipelineStage(pipeline, {
      stageId: "verify-plan",
      status: "completed",
      makeCurrent: false
    });

    pipeline = updateAuditPipelineStage(pipeline, {
      stageId: "security-scans",
      status: "completed",
      makeCurrent: false
    });

    pipeline = finalizeAuditPipeline(pipeline, "completed");

    expect(pipeline.status).toBe("completed");
    expect(pipeline.stages["agent-validation"].status).toBe("skipped");
    expect(pipeline.stages["quality-gate"].status).toBe("completed");
  });

  it("builds websocket candidates with localhost loopback fallback", () => {
    expect(buildLspWebSocketUrls("ws://localhost:3002")).toEqual([
      "ws://localhost:3002",
      "ws://127.0.0.1:3002/"
    ]);

    expect(buildLspWebSocketUrls("ws://127.0.0.1:3002")).toEqual([
      "ws://127.0.0.1:3002",
      "ws://localhost:3002/"
    ]);
  });

  it("allows PDF export when audit or PDF status is completed", () => {
    expect(canExportAuditPdf("completed", "not_requested")).toBe(true);
    expect(canExportAuditPdf("running", "completed")).toBe(true);
    expect(canExportAuditPdf("running", "queued")).toBe(false);
  });

  it("maps verify phase labels for execution tracker", () => {
    expect(verifyProgressPhaseLabel("plan-ready")).toBe("Plan Ready");
    expect(verifyProgressPhaseLabel("sandbox-running")).toBe("Sandbox Running");
    expect(verifyProgressPhaseLabel("sandbox-completed")).toBe("Sandbox Completed");
  });
});
