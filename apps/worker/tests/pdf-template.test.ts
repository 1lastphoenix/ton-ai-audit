import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditRunFindFirst: vi.fn(),
  findingInstancesFindMany: vi.fn(),
  findingTransitionsFindMany: vi.fn(),
  systemSettingsFindFirst: vi.fn(),
  insertValues: vi.fn(),
  updateSet: vi.fn(),
  recordJobEvent: vi.fn(),
  putObject: vi.fn(),
  launch: vi.fn(),
  capturedHtml: "",
  browserClose: vi.fn()
}));

vi.mock("../src/db", () => ({
  db: {
    query: {
      auditRuns: {
        findFirst: mocks.auditRunFindFirst
      },
      findingInstances: {
        findMany: mocks.findingInstancesFindMany
      },
      findingTransitions: {
        findMany: mocks.findingTransitionsFindMany
      },
      systemSettings: {
        findFirst: mocks.systemSettingsFindFirst
      }
    },
    insert: vi.fn(() => ({
      values: mocks.insertValues
    })),
    update: vi.fn(() => ({
      set: mocks.updateSet
    }))
  }
}));

vi.mock("../src/job-events", () => ({
  recordJobEvent: mocks.recordJobEvent
}));

vi.mock("../src/s3", () => ({
  putObject: mocks.putObject
}));

vi.mock("playwright", () => ({
  chromium: {
    launch: mocks.launch
  }
}));

import { createPdfProcessor } from "../src/processors/pdf";

function buildReportModel(params?: {
  used?: string;
  primary?: string;
  fallback?: string;
}) {
  return {
    schemaVersion: 2 as const,
    reportSchemaVersion: 2,
    engineVersion: "ton-audit-pro-v2",
    auditId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    revisionId: "33333333-3333-4333-8333-333333333333",
    generatedAt: "2026-01-01T00:00:00.000Z",
    profile: "deep" as const,
    model: {
      used: params?.used ?? "google/gemini-2.5-flash",
      primary: params?.primary ?? "google/gemini-2.5-flash",
      fallback: params?.fallback ?? "openai/gpt-4.1-mini"
    },
    executiveSummary: {
      overview: "Audit overview",
      keyRisks: ["Risk 1"],
      topRecommendations: ["Recommendation 1"],
      overallRisk: "medium" as const
    },
    methodology: {
      approach: "Static and dynamic checks",
      standards: ["OWASP-SC"],
      scope: ["contracts/main.tolk"],
      limitations: [],
      assumptions: []
    },
    verificationMatrix: [],
    riskPosture: {
      severityTotals: {},
      cvssAverage: null,
      maxCvssScore: null
    },
    taxonomySummary: {
      owaspCount: 0,
      cweCount: 0,
      swcCount: 0
    },
    findings: [],
    qualityGates: {
      taxonomyCoveragePct: 100,
      cvssCoveragePct: 100,
      passed: true,
      failures: []
    },
    modelTraceSummary: {
      steps: 0,
      totalToolCalls: 0,
      totalTokens: 0,
      usedFallback: false
    },
    summary: {
      overview: "Audit overview",
      methodology: "Static and dynamic checks",
      scope: ["contracts/main.tolk"],
      severityTotals: {}
    },
    appendix: {
      references: [],
      verificationNotes: [],
      internalNotes: []
    }
  };
}

describe("pdf processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capturedHtml = "";

    mocks.auditRunFindFirst.mockResolvedValue({
      id: "audit-1",
      projectId: "project-1",
      status: "completed",
      reportJson: buildReportModel(),
      primaryModelId: "google/gemini-2.5-flash",
      fallbackModelId: "openai/gpt-4.1-mini"
    });

    mocks.findingInstancesFindMany.mockResolvedValue([]);
    mocks.findingTransitionsFindMany.mockResolvedValue([]);
    mocks.systemSettingsFindFirst.mockResolvedValue(null);

    mocks.insertValues.mockImplementation(() => ({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined)
    }));

    mocks.updateSet.mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined)
    }));

    mocks.putObject.mockResolvedValue(undefined);

    const page = {
      setContent: vi.fn(async (html: string) => {
        mocks.capturedHtml = html;
      }),
      pdf: vi.fn(async () => Buffer.from("fake-pdf"))
    };

    mocks.launch.mockResolvedValue({
      newPage: vi.fn(async () => page),
      close: mocks.browserClose
    });
  });

  it("renders publication-grade sections in generated PDF HTML", async () => {
    const pdfProcessor = createPdfProcessor();

    const result = await pdfProcessor({
      id: "pdf-job-1",
      data: {
        projectId: "project-1",
        auditRunId: "audit-1",
        variant: "internal"
      }
    } as never);

    expect(result).toMatchObject({
      auditRunId: "audit-1",
      variant: "internal"
    });

    expect(mocks.capturedHtml).toContain("Table of Contents");
    expect(mocks.capturedHtml).toContain("Final Complete Audit PDF");
    expect(mocks.capturedHtml).toContain("Technical Appendix");
    expect(mocks.capturedHtml).toContain("Primary Model");
    expect(mocks.capturedHtml).toContain("Fallback Model");
  });

  it("uses the report model.used value in engagement metadata", async () => {
    mocks.auditRunFindFirst.mockResolvedValueOnce({
      id: "audit-1",
      projectId: "project-1",
      status: "completed",
      reportJson: buildReportModel({
        used: "anthropic/claude-sonnet-4",
        primary: "google/gemini-2.5-flash",
        fallback: "openai/gpt-4.1-mini"
      }),
      primaryModelId: "google/gemini-2.5-flash",
      fallbackModelId: "openai/gpt-4.1-mini"
    });

    const pdfProcessor = createPdfProcessor();

    await pdfProcessor({
      id: "pdf-job-2",
      data: {
        projectId: "project-1",
        auditRunId: "audit-1",
        variant: "internal"
      }
    } as never);

    expect(mocks.capturedHtml).toContain("AI/LLM Model Used");
    expect(mocks.capturedHtml).toContain("anthropic/claude-sonnet-4");
    expect(mocks.capturedHtml).toContain("google/gemini-2.5-flash");
    expect(mocks.capturedHtml).toContain("openai/gpt-4.1-mini");
  });
});