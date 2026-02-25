import { z } from "zod";

import { auditFindingSchema } from "./constants";
import { auditProfileSchema } from "./enums";

const reportModelSchema = z.object({
  used: z.string().min(1).optional(),
  primary: z.string().min(1),
  fallback: z.string().min(1)
});

const reportSummarySchema = z.object({
  overview: z.string().min(1),
  methodology: z.string().min(1),
  scope: z.array(z.string()).min(1),
  severityTotals: z.record(z.string(), z.number().int().nonnegative())
});

const reportAppendixSchema = z.object({
  references: z.array(z.string().url()),
  verificationNotes: z.array(z.string()),
  internalNotes: z.array(z.string()).default([])
});

export const auditReportV1Schema = z.object({
  auditId: z.string().uuid(),
  projectId: z.string().uuid(),
  revisionId: z.string().uuid(),
  generatedAt: z.string(),
  model: reportModelSchema,
  summary: reportSummarySchema,
  findings: z.array(auditFindingSchema),
  appendix: z.object({
    references: z.array(z.string().url()),
    verificationNotes: z.array(z.string())
  })
});

export const auditReportSchema = z.object({
  schemaVersion: z.literal(2).default(2),
  reportSchemaVersion: z.number().int().positive().default(2),
  engineVersion: z.string().min(1).default("ton-audit-pro-v2"),
  auditId: z.string().uuid(),
  projectId: z.string().uuid(),
  revisionId: z.string().uuid(),
  generatedAt: z.string(),
  profile: auditProfileSchema.default("deep"),
  model: reportModelSchema,
  executiveSummary: z.object({
    overview: z.string().min(1),
    keyRisks: z.array(z.string()).default([]),
    topRecommendations: z.array(z.string()).default([]),
    overallRisk: z.enum(["low", "medium", "high", "critical"]).default("medium")
  }),
  methodology: z.object({
    approach: z.string().min(1),
    standards: z.array(z.string().min(1)).default([]),
    scope: z.array(z.string()).min(1),
    limitations: z.array(z.string()).default([]),
    assumptions: z.array(z.string()).default([])
  }),
  verificationMatrix: z.array(
    z.object({
      stepType: z.string().min(1),
      status: z.enum(["queued", "running", "completed", "failed", "skipped"]),
      summary: z.string().min(1),
      artifactKeys: z.array(z.string().min(1)).default([])
    })
  ),
  riskPosture: z.object({
    severityTotals: z.record(z.string(), z.number().int().nonnegative()),
    cvssAverage: z.number().min(0).max(10).nullable(),
    maxCvssScore: z.number().min(0).max(10).nullable()
  }),
  taxonomySummary: z.object({
    owaspCount: z.number().int().nonnegative().default(0),
    cweCount: z.number().int().nonnegative().default(0),
    swcCount: z.number().int().nonnegative().default(0)
  }),
  findings: z.array(auditFindingSchema),
  qualityGates: z.object({
    taxonomyCoveragePct: z.number().min(0).max(100),
    cvssCoveragePct: z.number().min(0).max(100),
    passed: z.boolean(),
    failures: z.array(z.string()).default([])
  }),
  modelTraceSummary: z.object({
    steps: z.number().int().nonnegative(),
    totalToolCalls: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative().default(0),
    usedFallback: z.boolean().default(false)
  }),
  summary: reportSummarySchema,
  appendix: reportAppendixSchema
});

type AuditReportV1 = z.infer<typeof auditReportV1Schema>;
export type AuditReport = z.infer<typeof auditReportSchema>;

function toOverallRisk(severityTotals: Record<string, number>) {
  if ((severityTotals.critical ?? 0) > 0) {
    return "critical" as const;
  }
  if ((severityTotals.high ?? 0) > 0) {
    return "high" as const;
  }
  if ((severityTotals.medium ?? 0) > 0) {
    return "medium" as const;
  }
  return "low" as const;
}

function computeQualityCoverage(findings: AuditReport["findings"]) {
  const relevant = findings.filter((finding) => finding.severity !== "low" && finding.severity !== "informational");
  if (!relevant.length) {
    return {
      taxonomyCoveragePct: 100,
      cvssCoveragePct: 100,
      failures: [] as string[]
    };
  }

  const taxonomyCovered = relevant.filter((finding) => finding.taxonomy.length > 0).length;
  const cvssCovered = relevant.filter((finding) => Boolean(finding.cvssV31)).length;
  const taxonomyCoveragePct = (taxonomyCovered / relevant.length) * 100;
  const cvssCoveragePct = (cvssCovered / relevant.length) * 100;
  const failures: string[] = [];

  if (taxonomyCoveragePct < 100) {
    failures.push("Taxonomy mappings are missing for one or more medium+ findings.");
  }
  if (cvssCoveragePct < 100) {
    failures.push("CVSS vectors are missing for one or more medium+ findings.");
  }

  return {
    taxonomyCoveragePct,
    cvssCoveragePct,
    failures
  };
}

function normalizeLegacyReport(legacy: AuditReportV1): AuditReport {
  const severityTotals = legacy.summary.severityTotals;
  const cvssScores = legacy.findings
    .map((finding) => finding.cvssV31?.baseScore)
    .filter((score): score is number => typeof score === "number");
  const cvssAverage =
    cvssScores.length > 0
      ? cvssScores.reduce((sum, score) => sum + score, 0) / cvssScores.length
      : null;
  const maxCvssScore = cvssScores.length > 0 ? Math.max(...cvssScores) : null;
  const taxonomySummary = legacy.findings.reduce(
    (acc, finding) => {
      for (const reference of finding.taxonomy) {
        if (reference.standard === "owasp-sc") {
          acc.owaspCount += 1;
        } else if (reference.standard === "cwe") {
          acc.cweCount += 1;
        } else if (reference.standard === "swc") {
          acc.swcCount += 1;
        }
      }
      return acc;
    },
    {
      owaspCount: 0,
      cweCount: 0,
      swcCount: 0
    }
  );

  const coverage = computeQualityCoverage(legacy.findings);
  const keyRisks = legacy.findings
    .filter((finding) => finding.severity === "critical" || finding.severity === "high")
    .map((finding) => finding.title)
    .slice(0, 6);
  const topRecommendations = [...new Set(legacy.findings.map((finding) => finding.remediation))]
    .filter(Boolean)
    .slice(0, 6);

  return {
    schemaVersion: 2,
    reportSchemaVersion: 2,
    engineVersion: "ton-audit-pro-v2-normalized",
    auditId: legacy.auditId,
    projectId: legacy.projectId,
    revisionId: legacy.revisionId,
    generatedAt: legacy.generatedAt,
    profile: "deep",
    model: legacy.model,
    executiveSummary: {
      overview: legacy.summary.overview,
      keyRisks,
      topRecommendations,
      overallRisk: toOverallRisk(severityTotals)
    },
    methodology: {
      approach: legacy.summary.methodology,
      standards: ["OWASP-SC", "CWE", "SWC"],
      scope: legacy.summary.scope,
      limitations: ["Normalized from legacy report schema."],
      assumptions: []
    },
    verificationMatrix: legacy.appendix.verificationNotes.map((note, index) => ({
      stepType: `legacy-note-${index + 1}`,
      status: "completed" as const,
      summary: note,
      artifactKeys: []
    })),
    riskPosture: {
      severityTotals,
      cvssAverage,
      maxCvssScore
    },
    taxonomySummary,
    findings: legacy.findings,
    qualityGates: {
      taxonomyCoveragePct: coverage.taxonomyCoveragePct,
      cvssCoveragePct: coverage.cvssCoveragePct,
      passed: coverage.failures.length === 0,
      failures: coverage.failures
    },
    modelTraceSummary: {
      steps: 0,
      totalToolCalls: 0,
      totalTokens: 0,
      usedFallback: legacy.model.used === legacy.model.fallback
    },
    summary: legacy.summary,
    appendix: {
      references: legacy.appendix.references,
      verificationNotes: legacy.appendix.verificationNotes,
      internalNotes: []
    }
  };
}

export function normalizeAuditReport(input: unknown): AuditReport {
  const v2 = auditReportSchema.safeParse(input);
  if (v2.success) {
    return v2.data;
  }

  const v1 = auditReportV1Schema.parse(input);
  return normalizeLegacyReport(v1);
}
