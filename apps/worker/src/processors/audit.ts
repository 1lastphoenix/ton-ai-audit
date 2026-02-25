import { ToolLoopAgent, Output, embed, stepCountIs, tool } from "ai"
import { Job } from "bullmq"
import { and, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import {
  auditFindingSchema,
  auditRuns,
  auditReportSchema,
  createFindingFingerprint,
  docsChunks,
  docsSources,
  findingInstances,
  findingTransitions,
  findings,
  type JobPayloadMap,
  verificationSteps
} from "@ton-audit/shared"

import { db } from "../db"
import { env } from "../env"
import { recordJobEvent } from "../job-events"
import { workerLogger } from "../logger"
import { openrouter } from "../openrouter"
import { loadRevisionFilesWithContent, type RevisionFileContent } from "../revision-files"
import { getObjectText, putObject } from "../s3"
import type { EnqueueJob } from "./types"

type RetrievedDocChunk = {
  chunkId: string
  sourceUrl: string
  chunkText: string
}

type PriorFindingContext = {
  findingId: string
  severity: string
  title: string
  filePath: string
  summary: string
}

type AgentPassName = "discovery" | "validation" | "synthesis"

type AgentStepTrace = {
  pass: AgentPassName
  stepNumber: number
  modelId: string
  finishReason: string
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    reasoningTokens: number
    cachedInputTokens: number
  }
  toolCalls: string[]
  recordedAt: string
}

type NormalizedModelError = {
  message: string
  details: {
    name: string
    message: string
    stack?: string
    statusCode?: number
    isRetryable?: boolean
    url?: string
    providerMessage?: string
    providerCode?: string
    responseBodySnippet?: string
  }
  isRetryable: boolean | null
}

type VerificationArtifactRecord = {
  stepType: string
  status: string
  summary: string
  stdoutKey: string | null
  stderrKey: string | null
}

type QualityGateResult = {
  taxonomyCoveragePct: number
  cvssCoveragePct: number
  passed: boolean
  failures: string[]
}

type CvssMetrics = {
  AV: "N" | "A" | "L" | "P"
  AC: "L" | "H"
  PR: "N" | "L" | "H"
  UI: "N" | "R"
  S: "U" | "C"
  C: "N" | "L" | "H"
  I: "N" | "L" | "H"
  A: "N" | "L" | "H"
}

const discoveryPassSchema = z.object({
  overview: z.string().min(1),
  keyRisks: z.array(z.string().min(1)).default([]),
  candidates: z
    .array(
      z.object({
        candidateId: z.string().min(1),
        title: z.string().min(1),
        severity: z.enum(["critical", "high", "medium", "low", "informational"]),
        hypothesis: z.string().min(1),
        filePath: z.string().min(1),
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
        preconditions: z.array(z.string().min(1)).default([]),
        attackScenario: z.string().default(""),
        references: z.array(z.string()).default([])
      })
    )
    .default([])
})

const validationPassSchema = z.object({
  confirmedCandidateIds: z.array(z.string().min(1)).default([]),
  rejectedCandidateIds: z.array(z.string().min(1)).default([]),
  confidenceAdjustments: z
    .array(
      z.object({
        candidateId: z.string().min(1),
        confidence: z.number().min(0).max(1)
      })
    )
    .default([]),
  notes: z.array(z.string().min(1)).default([])
})

const synthesisPassSchema = z.object({
  overview: z.string().min(1),
  methodology: z.string().min(1),
  scope: z.array(z.string().min(1)).min(1).default(["Smart contract source and tests"]),
  keyRisks: z.array(z.string().min(1)).default([]),
  topRecommendations: z.array(z.string().min(1)).default([]),
  verificationNotes: z.array(z.string().min(1)).default([]),
  limitations: z.array(z.string().min(1)).default([]),
  assumptions: z.array(z.string().min(1)).default([]),
  findings: z.array(auditFindingSchema).default([])
})

const sourceSearchToolSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().positive().max(30).default(8)
})

const sourceSpanToolSchema = z.object({
  filePath: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  contextLines: z.number().int().min(0).max(12).default(2)
})

const verificationArtifactToolSchema = z.object({
  stepType: z.string().min(1).optional(),
  artifactKey: z.string().min(1).optional(),
  maxChars: z.number().int().positive().max(24_000).default(8_000)
})

const docsRetrievalToolSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().positive().max(12).default(6)
})

const priorFindingToolSchema = z.object({
  limit: z.number().int().positive().max(20).default(6),
  severity: z.string().optional()
})

const cvssMetricsSchema = z.object({
  AV: z.enum(["N", "A", "L", "P"]),
  AC: z.enum(["L", "H"]),
  PR: z.enum(["N", "L", "H"]),
  UI: z.enum(["N", "R"]),
  S: z.enum(["U", "C"]),
  C: z.enum(["N", "L", "H"]),
  I: z.enum(["N", "L", "H"]),
  A: z.enum(["N", "L", "H"])
})

const cvssToolSchema = z
  .object({
    vector: z.string().min(1).optional(),
    metrics: cvssMetricsSchema.optional()
  })
  .refine((value) => Boolean(value.vector || value.metrics), {
    message: "Either vector or metrics is required"
  })

const fallbackDocsUrls = [
  "https://docs.ton.org/contract-dev/blueprint/overview",
  "https://docs.ton.org/languages/tolk/overview",
  "https://docs.ton.org/languages/func/overview",
  "https://docs.ton.org/languages/tact/overview",
  "https://docs.ton.org/languages/fift/overview",
  "https://docs.ton.org/languages/tl-b/overview"
]

const CVSS_AV: Record<CvssMetrics["AV"], number> = {
  N: 0.85,
  A: 0.62,
  L: 0.55,
  P: 0.2
}

const CVSS_AC: Record<CvssMetrics["AC"], number> = {
  L: 0.77,
  H: 0.44
}

const CVSS_UI: Record<CvssMetrics["UI"], number> = {
  N: 0.85,
  R: 0.62
}

const CVSS_CIA: Record<"N" | "L" | "H", number> = {
  N: 0,
  L: 0.22,
  H: 0.56
}

class ReportQualityGateError extends Error {
  constructor(readonly failures: string[]) {
    super(`Report quality gate failed: ${failures.join(" | ")}`)
    this.name = "ReportQualityGateError"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function truncateForLog(value: string, max = 500) {
  if (value.length <= max) {
    return value
  }

  return `${value.slice(0, max)}...`
}

function normalizeTokenValue(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.trunc(value))
}

function makeAgentTrace(params: {
  pass: AgentPassName
  modelId: string
  step: {
    stepNumber: number
    finishReason?: string
    usage: {
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
      reasoningTokens?: number
      cachedInputTokens?: number
    }
    toolCalls: Array<{ toolName?: string }>
  }
}): AgentStepTrace {
  return {
    pass: params.pass,
    stepNumber: params.step.stepNumber,
    modelId: params.modelId,
    finishReason: params.step.finishReason ?? "unknown",
    usage: {
      inputTokens: normalizeTokenValue(params.step.usage.inputTokens),
      outputTokens: normalizeTokenValue(params.step.usage.outputTokens),
      totalTokens: normalizeTokenValue(params.step.usage.totalTokens),
      reasoningTokens: normalizeTokenValue(params.step.usage.reasoningTokens ?? 0),
      cachedInputTokens: normalizeTokenValue(params.step.usage.cachedInputTokens ?? 0)
    },
    toolCalls: params.step.toolCalls
      .map((item) => item.toolName ?? "")
      .filter((toolName) => toolName.length > 0),
    recordedAt: new Date().toISOString()
  }
}

function normalizeSeverity(value: string) {
  return value.trim().toLowerCase()
}

function hasMediumOrHigherSeverity(severity: string) {
  const normalized = normalizeSeverity(severity)
  return normalized === "critical" || normalized === "high" || normalized === "medium"
}

function deriveFixPriority(params: { severity: string; cvssScore: number | null }) {
  const normalized = normalizeSeverity(params.severity)

  if (normalized === "critical" || (params.cvssScore ?? 0) >= 9) {
    return "p0" as const
  }
  if (normalized === "high" || (params.cvssScore ?? 0) >= 7) {
    return "p1" as const
  }
  if (normalized === "medium" || (params.cvssScore ?? 0) >= 4) {
    return "p2" as const
  }
  return "p3" as const
}

function safeUrlList(values: string[]) {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    try {
      const parsed = new URL(value)
      const normalized = parsed.toString()
      if (seen.has(normalized)) {
        continue
      }
      seen.add(normalized)
      deduped.push(normalized)
    } catch {
      continue
    }
  }

  return deduped
}

function buildFileDigest(files: RevisionFileContent[]) {
  return files
    .slice(0, 24)
    .map((file) => {
      const preview = file.content.slice(0, 2_400)
      return `FILE: ${file.path}\n\`\`\`\n${preview}\n\`\`\``
    })
    .join("\n\n")
}

function parseCvssVector(vector: string): CvssMetrics | null {
  const normalized = vector.trim()
  if (!normalized) {
    return null
  }

  const parts = normalized.split("/").map((item) => item.trim())
  if (!parts.length) {
    return null
  }

  const metrics: Partial<CvssMetrics> = {}
  for (const part of parts) {
    if (part === "CVSS:3.1") {
      continue
    }

    const [rawKey, rawValue] = part.split(":")
    if (!rawKey || !rawValue) {
      continue
    }

    const key = rawKey.trim() as keyof CvssMetrics
    const value = rawValue.trim()
    if (
      key === "AV" &&
      (value === "N" || value === "A" || value === "L" || value === "P")
    ) {
      metrics.AV = value
      continue
    }
    if (key === "AC" && (value === "L" || value === "H")) {
      metrics.AC = value
      continue
    }
    if (key === "PR" && (value === "N" || value === "L" || value === "H")) {
      metrics.PR = value
      continue
    }
    if (key === "UI" && (value === "N" || value === "R")) {
      metrics.UI = value
      continue
    }
    if (key === "S" && (value === "U" || value === "C")) {
      metrics.S = value
      continue
    }
    if (
      (key === "C" || key === "I" || key === "A") &&
      (value === "N" || value === "L" || value === "H")
    ) {
      metrics[key] = value
      continue
    }
  }

  const parsed = cvssMetricsSchema.safeParse(metrics)
  return parsed.success ? parsed.data : null
}

function roundUp1(value: number) {
  return Math.ceil((value + 1e-10) * 10) / 10
}

function scoreToSeverity(score: number): "none" | "low" | "medium" | "high" | "critical" {
  if (score <= 0) {
    return "none"
  }
  if (score < 4) {
    return "low"
  }
  if (score < 7) {
    return "medium"
  }
  if (score < 9) {
    return "high"
  }
  return "critical"
}

function buildCvssVector(metrics: CvssMetrics) {
  return `CVSS:3.1/AV:${metrics.AV}/AC:${metrics.AC}/PR:${metrics.PR}/UI:${metrics.UI}/S:${metrics.S}/C:${metrics.C}/I:${metrics.I}/A:${metrics.A}`
}

function calculateCvss(metrics: CvssMetrics) {
  const prWeight =
    metrics.S === "U"
      ? { N: 0.85, L: 0.62, H: 0.27 }[metrics.PR]
      : { N: 0.85, L: 0.68, H: 0.5 }[metrics.PR]

  const exploitability = 8.22 * CVSS_AV[metrics.AV] * CVSS_AC[metrics.AC] * prWeight * CVSS_UI[metrics.UI]
  const iscBase = 1 - (1 - CVSS_CIA[metrics.C]) * (1 - CVSS_CIA[metrics.I]) * (1 - CVSS_CIA[metrics.A])
  const impact =
    metrics.S === "U"
      ? 6.42 * iscBase
      : 7.52 * (iscBase - 0.029) - 3.25 * Math.pow(iscBase - 0.02, 15)

  const baseScore =
    impact <= 0
      ? 0
      : metrics.S === "U"
        ? roundUp1(Math.min(impact + exploitability, 10))
        : roundUp1(Math.min(1.08 * (impact + exploitability), 10))

  return {
    vector: buildCvssVector(metrics),
    baseScore,
    severity: scoreToSeverity(baseScore),
    exploitabilityScore: roundUp1(exploitability),
    impactScore: roundUp1(Math.max(0, impact))
  }
}

function defaultCvssMetricsFromSeverity(severity: string): CvssMetrics {
  const normalized = normalizeSeverity(severity)
  if (normalized === "critical") {
    return { AV: "N", AC: "L", PR: "N", UI: "N", S: "C", C: "H", I: "H", A: "H" }
  }
  if (normalized === "high") {
    return { AV: "N", AC: "L", PR: "L", UI: "N", S: "U", C: "H", I: "H", A: "L" }
  }
  if (normalized === "medium") {
    return { AV: "L", AC: "H", PR: "L", UI: "R", S: "U", C: "L", I: "L", A: "L" }
  }
  if (normalized === "low") {
    return { AV: "L", AC: "H", PR: "H", UI: "R", S: "U", C: "L", I: "N", A: "N" }
  }

  return { AV: "P", AC: "H", PR: "H", UI: "R", S: "U", C: "N", I: "N", A: "N" }
}

function normalizeCvssPayload(
  candidate:
    | {
        vector?: string
        baseScore?: number
      }
    | undefined,
  severity: string
) {
  if (candidate?.vector) {
    const parsed = parseCvssVector(candidate.vector)
    if (parsed) {
      return calculateCvss(parsed)
    }
  }

  return calculateCvss(defaultCvssMetricsFromSeverity(severity))
}

function sanitizeTaxonomyEntries(
  entries: Array<{
    standard: string
    id: string
    title?: string | undefined
    url?: string | undefined
  }>
) {
  const normalized: Array<{
    standard: "owasp-sc" | "cwe" | "swc"
    id: string
    title?: string
    url?: string
  }> = []
  const seen = new Set<string>()

  for (const entry of entries) {
    const standard = entry.standard.toLowerCase()
    const id = entry.id.trim().toUpperCase()

    if (standard === "owasp-sc" && !/^SC\d{2}$/.test(id)) {
      continue
    }
    if (standard === "cwe" && !/^CWE-\d+$/.test(id)) {
      continue
    }
    if (standard === "swc" && !/^SWC-\d+$/.test(id)) {
      continue
    }
    if (standard !== "owasp-sc" && standard !== "cwe" && standard !== "swc") {
      continue
    }

    const dedupeKey = `${standard}:${id}`
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    normalized.push({
      standard,
      id,
      title: entry.title?.trim() || undefined,
      url: entry.url
    })
  }

  return normalized
}

function inferTaxonomyFromText(text: string) {
  const lower = text.toLowerCase()

  if (lower.includes("reentr")) {
    return [
      { standard: "owasp-sc", id: "SC05", title: "Reentrancy" },
      { standard: "cwe", id: "CWE-841", title: "Improper Enforcement of Behavioral Workflow" },
      { standard: "swc", id: "SWC-107", title: "Reentrancy" }
    ] as const
  }

  if (lower.includes("overflow") || lower.includes("underflow")) {
    return [
      { standard: "owasp-sc", id: "SC08", title: "Integer Issues" },
      { standard: "cwe", id: "CWE-190", title: "Integer Overflow or Wraparound" },
      { standard: "swc", id: "SWC-101", title: "Integer Overflow and Underflow" }
    ] as const
  }

  if (lower.includes("owner") || lower.includes("admin") || lower.includes("access")) {
    return [
      { standard: "owasp-sc", id: "SC01", title: "Access Control" },
      { standard: "cwe", id: "CWE-284", title: "Improper Access Control" },
      { standard: "swc", id: "SWC-105", title: "Unprotected Function" }
    ] as const
  }

  if (lower.includes("random") || lower.includes("entropy")) {
    return [
      { standard: "owasp-sc", id: "SC09", title: "Insecure Randomness" },
      { standard: "cwe", id: "CWE-330", title: "Use of Insufficiently Random Values" },
      { standard: "swc", id: "SWC-120", title: "Weak Sources of Randomness" }
    ] as const
  }

  if (lower.includes("gas") || lower.includes("loop") || lower.includes("dos")) {
    return [
      { standard: "owasp-sc", id: "SC10", title: "Denial of Service" },
      { standard: "cwe", id: "CWE-400", title: "Uncontrolled Resource Consumption" },
      { standard: "swc", id: "SWC-128", title: "DoS With Block Gas Limit" }
    ] as const
  }

  return [
    { standard: "owasp-sc", id: "SC06", title: "Unchecked External Calls" },
    { standard: "cwe", id: "CWE-693", title: "Protection Mechanism Failure" },
    { standard: "swc", id: "SWC-100", title: "Function Default Visibility" }
  ] as const
}

function extractAffectedContracts(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/")
  const fileName = normalized.split("/").pop() ?? normalized
  const contractName = fileName.replace(/\.(tact|tolk|fc|func|fif|fift|ts|js)$/i, "")
  return contractName ? [contractName] : []
}

function countTaxonomyCoverage(
  findings: Array<z.infer<typeof auditFindingSchema>>
) {
  const summary = findings.reduce(
    (acc, finding) => {
      for (const taxonomy of finding.taxonomy) {
        if (taxonomy.standard === "owasp-sc") {
          acc.owaspCount += 1
        } else if (taxonomy.standard === "cwe") {
          acc.cweCount += 1
        } else if (taxonomy.standard === "swc") {
          acc.swcCount += 1
        }
      }
      return acc
    },
    { owaspCount: 0, cweCount: 0, swcCount: 0 }
  )

  const mediumPlus = findings.filter((finding) => hasMediumOrHigherSeverity(finding.severity))
  if (!mediumPlus.length) {
    return {
      summary,
      quality: {
        taxonomyCoveragePct: 100,
        cvssCoveragePct: 100,
        passed: true,
        failures: []
      } satisfies QualityGateResult
    }
  }

  const taxonomyCovered = mediumPlus.filter((finding) => finding.taxonomy.length > 0).length
  const cvssCovered = mediumPlus.filter((finding) => Boolean(finding.cvssV31?.vector)).length
  const taxonomyCoveragePct = (taxonomyCovered / mediumPlus.length) * 100
  const cvssCoveragePct = (cvssCovered / mediumPlus.length) * 100
  const failures: string[] = []

  if (taxonomyCoveragePct < 100) {
    failures.push("Taxonomy mappings are missing for one or more medium+ findings.")
  }
  if (cvssCoveragePct < 100) {
    failures.push("CVSS vectors are missing for one or more medium+ findings.")
  }
  if (mediumPlus.length > 0) {
    if (summary.owaspCount === 0) {
      failures.push("OWASP smart-contract mapping coverage is missing.")
    }
    if (summary.cweCount === 0) {
      failures.push("CWE mapping coverage is missing.")
    }
    if (summary.swcCount === 0) {
      failures.push("SWC mapping coverage is missing.")
    }
  }

  return {
    summary,
    quality: {
      taxonomyCoveragePct,
      cvssCoveragePct,
      passed: failures.length === 0,
      failures
    } satisfies QualityGateResult
  }
}

function ensureFindingCitations(
  finding: z.infer<typeof auditFindingSchema>,
  docs: RetrievedDocChunk[]
) {
  const merged = safeUrlList([
    ...finding.references,
    ...docs.slice(0, 2).map((item) => item.sourceUrl)
  ])

  return {
    ...finding,
    references: merged
  }
}

function normalizeFinding(
  finding: z.infer<typeof auditFindingSchema>,
  filesByPath: Map<string, RevisionFileContent>,
  docs: RetrievedDocChunk[]
) {
  const filePath = finding.evidence.filePath
  const sourceFile = filesByPath.get(filePath)
  const maxLine = sourceFile ? sourceFile.content.split(/\r?\n/).length : finding.evidence.endLine
  const startLine = Math.max(1, Math.min(finding.evidence.startLine, maxLine))
  const endLine = Math.max(startLine, Math.min(finding.evidence.endLine, maxLine))
  const snippet =
    finding.evidence.snippet.trim() ||
    sourceFile?.content
      .split(/\r?\n/)
      .slice(startLine - 1, endLine)
      .join("\n") ||
    "No snippet available"

  const taxonomySeed = sanitizeTaxonomyEntries(finding.taxonomy)
  const mediumPlus = hasMediumOrHigherSeverity(finding.severity)
  const inferred = inferTaxonomyFromText(
    `${finding.title}\n${finding.summary}\n${finding.impact}\n${finding.exploitPath}`
  )
  const taxonomyWithFallback = mediumPlus
    ? sanitizeTaxonomyEntries([...taxonomySeed, ...inferred])
    : taxonomySeed

  const cvss = mediumPlus
    ? normalizeCvssPayload(finding.cvssV31, finding.severity)
    : finding.cvssV31
      ? normalizeCvssPayload(finding.cvssV31, finding.severity)
      : undefined

  const normalized = {
    ...ensureFindingCitations(finding, docs),
    evidence: {
      ...finding.evidence,
      filePath,
      startLine,
      endLine,
      snippet
    },
    taxonomy: taxonomyWithFallback,
    cvssV31: cvss,
    affectedContracts:
      finding.affectedContracts.length > 0 ? finding.affectedContracts : extractAffectedContracts(filePath),
    attackScenario: finding.attackScenario.trim() || finding.exploitPath,
    exploitability:
      finding.exploitability.trim() ||
      "Exploitability was assessed based on direct code-path reachability.",
    businessImpact: finding.businessImpact.trim() || finding.impact,
    technicalImpact: finding.technicalImpact.trim() || finding.impact,
    fixPriority: deriveFixPriority({
      severity: finding.severity,
      cvssScore: cvss?.baseScore ?? null
    }),
    verificationPlan:
      finding.verificationPlan.length > 0
        ? finding.verificationPlan
        : [
            "Create a regression test that reproduces the vulnerable execution path.",
            "Re-run deterministic verification and ensure this finding no longer appears.",
            "Validate remediation under adversarial input scenarios."
          ],
    preconditions:
      finding.preconditions.length > 0
        ? finding.preconditions
        : ["Attacker can invoke the affected external entrypoint."]
  }

  return auditFindingSchema.parse(normalized)
}

async function retrieveDocChunks(query: string): Promise<RetrievedDocChunk[]> {
  const queryTerms = query.slice(0, 10_000)
  const lexicalRows = await db.execute(sql`
    SELECT dc.id::text as chunk_id, ds.source_url, dc.chunk_text
    FROM docs_chunks dc
    INNER JOIN docs_sources ds ON ds.id = dc.source_id
    WHERE dc.lexemes @@ websearch_to_tsquery('english', ${queryTerms})
    ORDER BY ts_rank_cd(dc.lexemes, websearch_to_tsquery('english', ${queryTerms})) DESC
    LIMIT 10
  `)

  const lexicalChunks = (lexicalRows as unknown as { rows: Array<Record<string, unknown>> }).rows
    .map((row) => ({
      chunkId: String(row.chunk_id),
      sourceUrl: String(row.source_url),
      chunkText: String(row.chunk_text)
    }))
    .filter((row) => row.chunkId && row.sourceUrl && row.chunkText)

  let semanticChunks: RetrievedDocChunk[] = []
  try {
    const { embedding } = await embed({
      model: openrouter.textEmbeddingModel(env.OPENROUTER_EMBEDDINGS_MODEL),
      value: queryTerms.slice(0, 2_500)
    })

    const vectorLiteral = `[${embedding.join(",")}]`
    const semanticRows = await db.execute(sql`
      SELECT dc.id::text as chunk_id, ds.source_url, dc.chunk_text
      FROM docs_chunks dc
      INNER JOIN docs_sources ds ON ds.id = dc.source_id
      ORDER BY dc.embedding <=> ${vectorLiteral}::vector
      LIMIT 10
    `)

    semanticChunks = (semanticRows as unknown as { rows: Array<Record<string, unknown>> }).rows
      .map((row) => ({
        chunkId: String(row.chunk_id),
        sourceUrl: String(row.source_url),
        chunkText: String(row.chunk_text)
      }))
      .filter((row) => row.chunkId && row.sourceUrl && row.chunkText)
  } catch {
    semanticChunks = []
  }

  const mergedById = new Map<string, RetrievedDocChunk>()
  for (const chunk of lexicalChunks) {
    mergedById.set(chunk.chunkId, chunk)
  }
  for (const chunk of semanticChunks) {
    if (!mergedById.has(chunk.chunkId)) {
      mergedById.set(chunk.chunkId, chunk)
    }
  }

  const merged = [...mergedById.values()].slice(0, 10)
  if (merged.length >= 6) {
    return merged
  }

  const fallbackRows = await db
    .select({
      chunkId: docsChunks.id,
      sourceUrl: docsSources.sourceUrl,
      chunkText: docsChunks.chunkText
    })
    .from(docsChunks)
    .innerJoin(docsSources, eq(docsChunks.sourceId, docsSources.id))
    .orderBy(desc(docsChunks.createdAt))
    .limit(10)

  const deduped = new Map<string, RetrievedDocChunk>()
  for (const chunk of [...merged, ...fallbackRows]) {
    const normalized: RetrievedDocChunk = {
      chunkId: chunk.chunkId,
      sourceUrl: chunk.sourceUrl,
      chunkText: chunk.chunkText
    }
    if (!deduped.has(normalized.chunkId)) {
      deduped.set(normalized.chunkId, normalized)
    }
  }

  return [...deduped.values()].slice(0, 10)
}

async function fetchFallbackDocs(): Promise<RetrievedDocChunk[]> {
  const chunks: RetrievedDocChunk[] = []

  for (const sourceUrl of fallbackDocsUrls.slice(0, 4)) {
    try {
      const response = await fetch(sourceUrl)
      if (!response.ok) {
        continue
      }

      const body = await response.text()
      const text = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2_000)
      if (!text) {
        continue
      }

      chunks.push({
        chunkId: `fallback:${sourceUrl}`,
        sourceUrl,
        chunkText: text
      })
    } catch {
      continue
    }
  }

  return chunks
}

function extractProviderErrorDetails(params: { responseBody?: string; data?: unknown }) {
  let providerMessage: string | null = null
  let providerCode: string | null = null
  let responseBodySnippet: string | null = null

  if (isRecord(params.data)) {
    const node = isRecord(params.data.error) ? params.data.error : params.data
    if (typeof node.message === "string" && node.message.trim()) {
      providerMessage = node.message.trim()
    }
    if (typeof node.code === "string" && node.code.trim()) {
      providerCode = node.code.trim()
    }
  }

  if (params.responseBody && params.responseBody.trim()) {
    const raw = params.responseBody.trim()
    responseBodySnippet = truncateForLog(raw, 1_200)

    try {
      const parsed = JSON.parse(raw) as unknown
      if (isRecord(parsed)) {
        const node = isRecord(parsed.error) ? parsed.error : parsed
        if (!providerMessage && typeof node.message === "string" && node.message.trim()) {
          providerMessage = node.message.trim()
        }
        if (!providerCode && typeof node.code === "string" && node.code.trim()) {
          providerCode = node.code.trim()
        }
      }
    } catch {
      // keep raw snippet
    }
  }

  return {
    providerMessage,
    providerCode,
    responseBodySnippet
  }
}

function normalizeModelError(error: unknown): NormalizedModelError {
  if (!(error instanceof Error)) {
    return {
      message: "Unknown model invocation error",
      details: {
        name: "UnknownError",
        message: "Unknown model invocation error"
      },
      isRetryable: null
    }
  }

  const apiError = error as Error & {
    statusCode?: unknown
    isRetryable?: unknown
    url?: unknown
    responseBody?: unknown
    data?: unknown
  }

  const statusCode = typeof apiError.statusCode === "number" ? apiError.statusCode : undefined
  const isRetryable = typeof apiError.isRetryable === "boolean" ? apiError.isRetryable : null
  const url = typeof apiError.url === "string" ? apiError.url : undefined
  const responseBody = typeof apiError.responseBody === "string" ? apiError.responseBody : undefined
  const providerDetails = extractProviderErrorDetails({
    responseBody,
    data: apiError.data
  })

  const details: NormalizedModelError["details"] = {
    name: error.name,
    message: error.message
  }
  if (error.stack) {
    details.stack = error.stack
  }
  if (statusCode !== undefined) {
    details.statusCode = statusCode
  }
  if (isRetryable !== null) {
    details.isRetryable = isRetryable
  }
  if (url) {
    details.url = url
  }
  if (providerDetails.providerMessage) {
    details.providerMessage = providerDetails.providerMessage
  }
  if (providerDetails.providerCode) {
    details.providerCode = providerDetails.providerCode
  }
  if (providerDetails.responseBodySnippet) {
    details.responseBodySnippet = providerDetails.responseBodySnippet
  }

  const messageParts = [error.message]
  if (statusCode !== undefined) {
    messageParts.push(`status ${statusCode}`)
  }
  if (providerDetails.providerMessage && providerDetails.providerMessage !== error.message) {
    messageParts.push(providerDetails.providerMessage)
  }

  return {
    message: messageParts.join(" | "),
    details,
    isRetryable
  }
}

async function loadPriorFindingContext(params: {
  projectId: string
  createdAt: Date
}): Promise<PriorFindingContext[]> {
  const rows = await db
    .select({
      findingId: findingInstances.findingId,
      severity: findingInstances.severity,
      payloadJson: findingInstances.payloadJson
    })
    .from(findingInstances)
    .innerJoin(auditRuns, eq(findingInstances.auditRunId, auditRuns.id))
    .where(
      and(
        eq(auditRuns.projectId, params.projectId),
        eq(auditRuns.status, "completed"),
        sql`${auditRuns.createdAt} < ${params.createdAt}`
      )
    )
    .orderBy(desc(auditRuns.createdAt))
    .limit(50)

  const deduped = new Map<string, PriorFindingContext>()
  for (const row of rows) {
    if (deduped.has(row.findingId)) {
      continue
    }

    const payload = isRecord(row.payloadJson) ? row.payloadJson : {}
    const evidence = isRecord(payload.evidence) ? payload.evidence : {}
    deduped.set(row.findingId, {
      findingId: row.findingId,
      severity: row.severity,
      title: typeof payload.title === "string" ? payload.title : "Untitled finding",
      filePath: typeof evidence.filePath === "string" ? evidence.filePath : "unknown",
      summary: typeof payload.summary === "string" ? payload.summary : ""
    })
  }

  return [...deduped.values()]
}

function searchSourceLines(params: { files: RevisionFileContent[]; query: string; maxResults: number }) {
  const terms = params.query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)

  const matches: Array<{
    filePath: string
    line: number
    snippet: string
  }> = []

  for (const file of params.files) {
    const lines = file.content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ""
      const normalized = line.toLowerCase()
      const hasAllTerms = terms.every((term) => normalized.includes(term))
      if (!hasAllTerms) {
        continue
      }

      matches.push({
        filePath: file.path,
        line: index + 1,
        snippet: line.trim().slice(0, 280)
      })

      if (matches.length >= params.maxResults) {
        return matches
      }
    }
  }

  return matches
}

function readSourceSpan(params: {
  filesByPath: Map<string, RevisionFileContent>
  filePath: string
  startLine: number
  endLine: number
  contextLines: number
}) {
  const file = params.filesByPath.get(params.filePath)
  if (!file) {
    return null
  }

  const lines = file.content.split(/\r?\n/)
  const start = Math.max(1, params.startLine - params.contextLines)
  const end = Math.min(lines.length, params.endLine + params.contextLines)
  const snippet = lines
    .slice(start - 1, end)
    .map((line, index) => `${start + index}: ${line}`)
    .join("\n")

  return {
    filePath: params.filePath,
    startLine: start,
    endLine: end,
    snippet
  }
}

function buildVerificationMatrix(verificationArtifacts: VerificationArtifactRecord[]) {
  return verificationArtifacts.map((row) => ({
    stepType: row.stepType,
    status:
      row.status === "queued" ||
      row.status === "running" ||
      row.status === "completed" ||
      row.status === "failed" ||
      row.status === "skipped"
        ? row.status
        : "failed",
    summary: row.summary || "No summary provided",
    artifactKeys: [row.stdoutKey, row.stderrKey].filter((item): item is string => Boolean(item))
  }))
}

function buildModelTraceSummary(stepTraces: AgentStepTrace[]) {
  const totalToolCalls = stepTraces.reduce((sum, step) => sum + step.toolCalls.length, 0)
  const totalTokens = stepTraces.reduce((sum, step) => sum + step.usage.totalTokens, 0)

  return {
    steps: stepTraces.length,
    totalToolCalls,
    totalTokens
  }
}

async function readArtifactWithCache(
  key: string,
  cache: Map<string, string | null>
) {
  if (cache.has(key)) {
    return cache.get(key) ?? null
  }

  const value = await getObjectText(key)
  cache.set(key, value)
  return value
}

function buildDiscoveryPrompt(params: {
  profile: "fast" | "deep"
  verificationSummary: string
  fileDigest: string
  docs: RetrievedDocChunk[]
  priorFindings: PriorFindingContext[]
}) {
  const docsSummary = params.docs
    .slice(0, 8)
    .map((doc) => `SOURCE: ${doc.sourceUrl}\n${doc.chunkText.slice(0, 1_300)}`)
    .join("\n\n")
  const priorSummary = params.priorFindings
    .slice(0, 10)
    .map(
      (finding) =>
        `${finding.severity.toUpperCase()} ${finding.title} @ ${finding.filePath} :: ${finding.summary}`
    )
    .join("\n")

  return [
    "Perform candidate discovery for a TON smart contract security audit.",
    "Only include candidates with direct source evidence and plausible exploitability.",
    `Execution profile: ${params.profile}.`,
    "",
    "Verification summary:",
    params.verificationSummary || "No verification summary available.",
    "",
    "Code digest:",
    params.fileDigest,
    "",
    "Documentation context:",
    docsSummary || "No indexed documentation context available.",
    "",
    "Prior findings context:",
    priorSummary || "No prior findings available."
  ].join("\n")
}

function buildValidationPrompt(params: {
  candidates: z.infer<typeof discoveryPassSchema>["candidates"]
  verificationSummary: string
}) {
  return [
    "Adversarially validate candidate findings from the discovery pass.",
    "Reject false positives where exploit path preconditions are not satisfiable.",
    "Increase confidence only when evidence is deterministic and reproducible.",
    "",
    "Verification summary:",
    params.verificationSummary || "No verification summary available.",
    "",
    "Candidates:",
    JSON.stringify(params.candidates, null, 2)
  ].join("\n")
}

function buildSynthesisPrompt(params: {
  profile: "fast" | "deep"
  candidates: z.infer<typeof discoveryPassSchema>["candidates"]
  validation: z.infer<typeof validationPassSchema> | null
  verificationSummary: string
}) {
  return [
    "Synthesize a final security audit output from validated evidence.",
    "Output must include precise remediation, exploit path, and confidence for each finding.",
    "For medium/high/critical findings include taxonomy and CVSS vectors.",
    "Do not include speculative issues without deterministic evidence.",
    `Execution profile: ${params.profile}.`,
    "",
    "Verification summary:",
    params.verificationSummary || "No verification summary available.",
    "",
    "Candidates:",
    JSON.stringify(params.candidates, null, 2),
    "",
    "Validation results:",
    JSON.stringify(params.validation, null, 2)
  ].join("\n")
}

async function runModelPipeline(params: {
  modelId: string
  profile: "fast" | "deep"
  files: RevisionFileContent[]
  docs: RetrievedDocChunk[]
  priorFindings: PriorFindingContext[]
  verificationArtifacts: VerificationArtifactRecord[]
  verificationSummary: string
  auditId: string
  projectId: string
  onPhaseEvent: (phase: string, payload?: Record<string, unknown>) => Promise<void>
}) {
  const filesByPath = new Map(params.files.map((file) => [file.path, file]))
  const stepTraces: AgentStepTrace[] = []
  const docsAccessed = new Set<string>(params.docs.map((item) => item.sourceUrl))
  const artifactCache = new Map<string, string | null>()

  const profileBudgets =
    params.profile === "deep"
      ? { discovery: 12, validation: 12, synthesis: 14 }
      : { discovery: 6, validation: 0, synthesis: 7 }

  const commonInstructions = [
    "You are an elite TON smart-contract security auditor.",
    "You must use tools to verify source evidence before finalizing findings.",
    "Map medium+ findings to OWASP smart-contract risks, CWE IDs, and SWC IDs.",
    "Produce deterministic, publication-grade audit outputs."
  ].join(" ")

  const passTools = {
    sourceSearch: tool({
      description: "Search source files for exact query matches and line numbers.",
      inputSchema: sourceSearchToolSchema,
      execute: async ({ query, maxResults }) => {
        return {
          query,
          results: searchSourceLines({
            files: params.files,
            query,
            maxResults
          })
        }
      }
    }),
    sourceSpanReader: tool({
      description: "Read a precise source span with nearby context lines.",
      inputSchema: sourceSpanToolSchema,
      execute: async ({ filePath, startLine, endLine, contextLines }) => {
        const span = readSourceSpan({
          filesByPath,
          filePath,
          startLine,
          endLine,
          contextLines
        })

        return span ?? { filePath, error: "File not found in revision snapshot" }
      }
    }),
    verificationArtifactReader: tool({
      description: "Read verification artifact outputs (stdout/stderr/JSON) by stepType or object key.",
      inputSchema: verificationArtifactToolSchema,
      execute: async ({ stepType, artifactKey, maxChars }) => {
        if (artifactKey) {
          const text = await readArtifactWithCache(artifactKey, artifactCache)
          return {
            artifactKey,
            content: (text ?? "").slice(0, maxChars)
          }
        }

        if (!stepType) {
          return { error: "stepType or artifactKey is required" }
        }

        const artifact = params.verificationArtifacts.find((item) => item.stepType === stepType)
        if (!artifact) {
          return { stepType, error: "Verification step not found" }
        }

        const stdout = artifact.stdoutKey
          ? ((await readArtifactWithCache(artifact.stdoutKey, artifactCache)) ?? "")
          : ""
        const stderr = artifact.stderrKey
          ? ((await readArtifactWithCache(artifact.stderrKey, artifactCache)) ?? "")
          : ""

        return {
          stepType,
          status: artifact.status,
          summary: artifact.summary,
          stdout: stdout.slice(0, maxChars),
          stderr: stderr.slice(0, maxChars)
        }
      }
    }),
    docsRetrieval: tool({
      description: "Retrieve TON documentation chunks relevant to a security issue or remediation.",
      inputSchema: docsRetrievalToolSchema,
      execute: async ({ query, maxResults }) => {
        const chunks = (await retrieveDocChunks(query)).slice(0, maxResults)
        for (const chunk of chunks) {
          docsAccessed.add(chunk.sourceUrl)
        }
        return {
          query,
          chunks
        }
      }
    }),
    priorFindingContextReader: tool({
      description: "Read prior finding context to classify persisting vs newly surfaced issues.",
      inputSchema: priorFindingToolSchema,
      execute: async ({ limit, severity }) => {
        const selected = params.priorFindings
          .filter((item) =>
            severity ? normalizeSeverity(item.severity) === normalizeSeverity(severity) : true
          )
          .slice(0, limit)

        return {
          count: selected.length,
          findings: selected
        }
      }
    }),
    cvssCalculator: tool({
      description: "Validate or calculate CVSS v3.1 vectors and scores deterministically.",
      inputSchema: cvssToolSchema,
      execute: async ({ vector, metrics }) => {
        if (vector) {
          const parsed = parseCvssVector(vector)
          if (!parsed) {
            return {
              valid: false,
              error: "Invalid CVSS v3.1 vector"
            }
          }

          return {
            valid: true,
            ...calculateCvss(parsed)
          }
        }

        if (!metrics) {
          return { valid: false, error: "No metrics provided" }
        }

        return {
          valid: true,
          ...calculateCvss(metrics)
        }
      }
    })
  }

  const collectStepTrace =
    (pass: AgentPassName) =>
    (step: {
      stepNumber: number
      finishReason?: string
      usage: {
        inputTokens?: number
        outputTokens?: number
        totalTokens?: number
        reasoningTokens?: number
        cachedInputTokens?: number
      }
      toolCalls: Array<{ toolName?: string }>
    }) => {
      stepTraces.push(
        makeAgentTrace({
          pass,
          modelId: params.modelId,
          step
        })
      )
    }

  const discoveryPrompt = buildDiscoveryPrompt({
    profile: params.profile,
    verificationSummary: params.verificationSummary,
    fileDigest: buildFileDigest(params.files),
    docs: params.docs,
    priorFindings: params.priorFindings
  })

  await params.onPhaseEvent("agent-discovery", {
    modelId: params.modelId,
    profile: params.profile
  })

  const discoveryAgent = new ToolLoopAgent({
    model: openrouter(params.modelId),
    instructions: commonInstructions,
    tools: passTools,
    output: Output.object({ schema: discoveryPassSchema }),
    stopWhen: stepCountIs(profileBudgets.discovery),
    onStepFinish: collectStepTrace("discovery")
  })

  const discoveryResult = await discoveryAgent.generate({ prompt: discoveryPrompt })
  const discovered = discoveryResult.output

  let validationResult: z.infer<typeof validationPassSchema> | null = null
  if (params.profile === "deep") {
    await params.onPhaseEvent("agent-validation", {
      modelId: params.modelId,
      profile: params.profile
    })

    const validationAgent = new ToolLoopAgent({
      model: openrouter(params.modelId),
      instructions: commonInstructions,
      tools: passTools,
      output: Output.object({ schema: validationPassSchema }),
      stopWhen: stepCountIs(profileBudgets.validation),
      onStepFinish: collectStepTrace("validation")
    })

    validationResult = await validationAgent
      .generate({
        prompt: buildValidationPrompt({
          candidates: discovered.candidates,
          verificationSummary: params.verificationSummary
        })
      })
      .then((result) => result.output)
  }

  const confirmedCandidateIds =
    params.profile === "deep"
      ? new Set(validationResult?.confirmedCandidateIds ?? [])
      : new Set(discovered.candidates.map((candidate) => candidate.candidateId))
  const filteredCandidates =
    params.profile === "deep"
      ? discovered.candidates.filter((candidate) => confirmedCandidateIds.has(candidate.candidateId))
      : discovered.candidates

  await params.onPhaseEvent("agent-synthesis", {
    modelId: params.modelId,
    candidateCount: filteredCandidates.length
  })

  const synthesisAgent = new ToolLoopAgent({
    model: openrouter(params.modelId),
    instructions: commonInstructions,
    tools: passTools,
    output: Output.object({ schema: synthesisPassSchema }),
    stopWhen: stepCountIs(profileBudgets.synthesis),
    onStepFinish: collectStepTrace("synthesis")
  })

  const synthesisResult = await synthesisAgent.generate({
    prompt: buildSynthesisPrompt({
      profile: params.profile,
      candidates: filteredCandidates,
      validation: validationResult,
      verificationSummary: params.verificationSummary
    })
  })

  const normalizedFindings = synthesisResult.output.findings.map((finding) =>
    normalizeFinding(finding, filesByPath, params.docs)
  )

  const withFindingIds = normalizedFindings.map((finding) => ({
    ...finding,
    findingId:
      finding.findingId ||
      createFindingFingerprint({
        title: finding.title,
        filePath: finding.evidence.filePath,
        startLine: finding.evidence.startLine,
        endLine: finding.evidence.endLine,
        severity: finding.severity
      })
  }))

  const coverage = countTaxonomyCoverage(withFindingIds)
  const severityTotals = withFindingIds.reduce<Record<string, number>>((acc, finding) => {
    const key = normalizeSeverity(finding.severity)
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  const cvssScores = withFindingIds
    .map((finding) => finding.cvssV31?.baseScore)
    .filter((score): score is number => typeof score === "number")
  const cvssAverage =
    cvssScores.length > 0
      ? Number((cvssScores.reduce((sum, score) => sum + score, 0) / cvssScores.length).toFixed(2))
      : null
  const maxCvssScore = cvssScores.length > 0 ? Math.max(...cvssScores) : null

  const traceSummary = buildModelTraceSummary(stepTraces)
  const reportDraft = {
    findings: withFindingIds,
    severityTotals,
    cvssAverage,
    maxCvssScore,
    qualityGates: coverage.quality,
    taxonomySummary: coverage.summary,
    synthesis: synthesisResult.output,
    traceSummary,
    stepTraces,
    docsReferences: safeUrlList([...docsAccessed])
  }

  return reportDraft
}

export function createAuditProcessor(deps: { enqueueJob: EnqueueJob }) {
  return async function audit(job: Job<JobPayloadMap["audit"]>) {
    const context = {
      queue: "audit",
      jobId: String(job.id),
      projectId: job.data.projectId,
      revisionId: job.data.revisionId,
      auditRunId: job.data.auditRunId,
      profile: job.data.profile
    }

    workerLogger.info("audit.stage.started", context)

    await recordJobEvent({
      projectId: job.data.projectId,
      queue: "audit",
      jobId: String(job.id),
      event: "started",
      payload: { data: job.data }
    })

    const auditRun = await db.query.auditRuns.findFirst({
      where: and(eq(auditRuns.id, job.data.auditRunId), eq(auditRuns.projectId, job.data.projectId))
    })

    if (!auditRun) {
      throw new Error("Audit run not found")
    }

    const emitPhaseEvent = async (phase: string, payload?: Record<string, unknown>) => {
      await recordJobEvent({
        projectId: job.data.projectId,
        queue: "audit",
        jobId: String(job.id),
        event: "progress",
        payload: {
          auditRunId: auditRun.id,
          phase,
          ...(payload ?? {})
        }
      })
    }

    workerLogger.info("audit.stage.audit-run-found", {
      ...context,
      runStatus: auditRun.status,
      includeDocsFallbackFetch: job.data.includeDocsFallbackFetch
    })

    try {
      const files = await loadRevisionFilesWithContent(job.data.revisionId)
      if (!files.length) {
        throw new Error("Revision has no files to audit")
      }

      const verificationRows = await db.query.verificationSteps.findMany({
        where: eq(verificationSteps.auditRunId, auditRun.id)
      })
      const verificationArtifacts: VerificationArtifactRecord[] = verificationRows.map((row) => ({
        stepType: row.stepType,
        status: row.status,
        summary: row.summary ?? "No summary",
        stdoutKey: row.stdoutKey,
        stderrKey: row.stderrKey
      }))
      const verificationSummary = verificationArtifacts
        .map((row) => `[${row.status}] ${row.stepType}: ${row.summary}`)
        .join("\n")

      const priorFindingContext = await loadPriorFindingContext({
        projectId: auditRun.projectId,
        createdAt: auditRun.createdAt
      })

      workerLogger.info("audit.stage.inputs-loaded", {
        ...context,
        fileCount: files.length,
        verificationStepCount: verificationRows.length,
        priorFindingCount: priorFindingContext.length
      })

      const retrievalQuery = files
        .slice(0, 20)
        .map((file) => `${file.path} ${file.content.slice(0, 200)}`)
        .join("\n")

      let docs = await retrieveDocChunks(retrievalQuery)
      if (docs.length === 0 && job.data.includeDocsFallbackFetch) {
        workerLogger.info("audit.stage.docs-fallback-requested", context)
        docs = await fetchFallbackDocs()
      }

      workerLogger.info("audit.stage.docs-loaded", {
        ...context,
        docsCount: docs.length
      })

      const runPipelineWithRetry = async (params: {
        modelId: string
        stage: "primary" | "fallback"
      }) => {
        const maxAttempts = 2
        let lastError: unknown = null
        let lastNormalizedError: NormalizedModelError | null = null

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            if (attempt > 1) {
              workerLogger.info("audit.stage.model-retry-attempt", {
                ...context,
                stage: params.stage,
                modelId: params.modelId,
                attempt
              })
            }

            const result = await runModelPipeline({
              modelId: params.modelId,
              profile: job.data.profile,
              files,
              docs,
              priorFindings: priorFindingContext,
              verificationArtifacts,
              verificationSummary,
              auditId: auditRun.id,
              projectId: auditRun.projectId,
              onPhaseEvent: emitPhaseEvent
            })

            await emitPhaseEvent("report-quality-gate", {
              modelId: params.modelId,
              passed: result.qualityGates.passed,
              failures: result.qualityGates.failures
            })

            if (!result.qualityGates.passed) {
              throw new ReportQualityGateError(result.qualityGates.failures)
            }

            return result
          } catch (error) {
            lastError = error
            if (error instanceof ReportQualityGateError) {
              workerLogger.warn("audit.stage.quality-gate-failed", {
                ...context,
                stage: params.stage,
                modelId: params.modelId,
                attempt,
                failures: error.failures
              })

              if (attempt < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, attempt * 2_000))
              }
              continue
            }

            const normalizedError = normalizeModelError(error)
            lastNormalizedError = normalizedError
            workerLogger.warn("audit.stage.model-attempt-failed", {
              ...context,
              stage: params.stage,
              modelId: params.modelId,
              attempt,
              error: normalizedError.details
            })

            if (normalizedError.isRetryable === false) {
              workerLogger.info("audit.stage.model-retry-skipped", {
                ...context,
                stage: params.stage,
                modelId: params.modelId,
                attempt,
                reason: "provider-marked-non-retryable",
                statusCode: normalizedError.details.statusCode
              })
              break
            }

            if (attempt < maxAttempts) {
              await new Promise((resolve) => setTimeout(resolve, attempt * 2_000))
            }
          }
        }

        if (lastError instanceof Error) {
          throw lastError
        }

        throw new Error(lastNormalizedError?.message ?? "Model invocation failed")
      }

      let usedModel = auditRun.primaryModelId
      let usedFallback = false
      let pipelineResult: Awaited<ReturnType<typeof runPipelineWithRetry>>

      workerLogger.info("audit.stage.model-primary-started", {
        ...context,
        modelId: auditRun.primaryModelId
      })

      try {
        pipelineResult = await runPipelineWithRetry({
          modelId: auditRun.primaryModelId,
          stage: "primary"
        })
        workerLogger.info("audit.stage.model-primary-completed", {
          ...context,
          modelId: auditRun.primaryModelId
        })
      } catch (primaryError) {
        const normalizedPrimaryError = normalizeModelError(primaryError)
        workerLogger.warn("audit.stage.model-primary-failed", {
          ...context,
          modelId: auditRun.primaryModelId,
          error: normalizedPrimaryError.details
        })

        usedModel = auditRun.fallbackModelId
        usedFallback = true
        workerLogger.info("audit.stage.model-fallback-started", {
          ...context,
          modelId: auditRun.fallbackModelId
        })

        pipelineResult = await runPipelineWithRetry({
          modelId: auditRun.fallbackModelId,
          stage: "fallback"
        })

        workerLogger.info("audit.stage.model-fallback-completed", {
          ...context,
          modelId: auditRun.fallbackModelId
        })

        await putObject({
          key: `audits/${auditRun.id}/primary-error.json`,
          body: JSON.stringify(
            {
              message: normalizedPrimaryError.message,
              error: normalizedPrimaryError.details
            },
            null,
            2
          ),
          contentType: "application/json"
        })
      }

      const transitions = await db.query.findingTransitions.findMany({
        where: eq(findingTransitions.toAuditRunId, auditRun.id)
      })
      const transitionSummary = transitions.reduce<Record<string, number>>((acc, row) => {
        acc[row.transition] = (acc[row.transition] ?? 0) + 1
        return acc
      }, {})

      const internalNotes = [
        ...pipelineResult.synthesis.limitations.map((item) => `Limitation: ${item}`),
        ...pipelineResult.synthesis.assumptions.map((item) => `Assumption: ${item}`),
        `Diff summary -> opened: ${transitionSummary.opened ?? 0}, resolved: ${transitionSummary.resolved ?? 0}, regressed: ${transitionSummary.regressed ?? 0}, unchanged: ${transitionSummary.unchanged ?? 0}`
      ]

      const report = auditReportSchema.parse({
        schemaVersion: 2,
        reportSchemaVersion: auditRun.reportSchemaVersion,
        engineVersion: auditRun.engineVersion,
        auditId: auditRun.id,
        projectId: auditRun.projectId,
        revisionId: auditRun.revisionId,
        generatedAt: new Date().toISOString(),
        profile: job.data.profile,
        model: {
          used: usedModel,
          primary: auditRun.primaryModelId,
          fallback: auditRun.fallbackModelId
        },
        executiveSummary: {
          overview: pipelineResult.synthesis.overview,
          keyRisks: pipelineResult.synthesis.keyRisks,
          topRecommendations: pipelineResult.synthesis.topRecommendations,
          overallRisk:
            (pipelineResult.severityTotals.critical ?? 0) > 0
              ? "critical"
              : (pipelineResult.severityTotals.high ?? 0) > 0
                ? "high"
                : (pipelineResult.severityTotals.medium ?? 0) > 0
                  ? "medium"
                  : "low"
        },
        methodology: {
          approach: pipelineResult.synthesis.methodology,
          standards: ["OWASP-SC", "CWE", "SWC", "CVSS v3.1"],
          scope: pipelineResult.synthesis.scope,
          limitations: pipelineResult.synthesis.limitations,
          assumptions: pipelineResult.synthesis.assumptions
        },
        verificationMatrix: buildVerificationMatrix(verificationArtifacts),
        riskPosture: {
          severityTotals: pipelineResult.severityTotals,
          cvssAverage: pipelineResult.cvssAverage,
          maxCvssScore: pipelineResult.maxCvssScore
        },
        taxonomySummary: pipelineResult.taxonomySummary,
        findings: pipelineResult.findings,
        qualityGates: pipelineResult.qualityGates,
        modelTraceSummary: {
          steps: pipelineResult.traceSummary.steps,
          totalToolCalls: pipelineResult.traceSummary.totalToolCalls,
          totalTokens: pipelineResult.traceSummary.totalTokens,
          usedFallback
        },
        summary: {
          overview: pipelineResult.synthesis.overview,
          methodology: pipelineResult.synthesis.methodology,
          scope: pipelineResult.synthesis.scope,
          severityTotals: pipelineResult.severityTotals
        },
        appendix: {
          references: safeUrlList([
            ...pipelineResult.docsReferences,
            ...pipelineResult.findings.flatMap((finding) => finding.references)
          ]),
          verificationNotes: [
            ...pipelineResult.synthesis.verificationNotes,
            ...verificationArtifacts.map((artifact) => `[${artifact.status}] ${artifact.stepType}: ${artifact.summary}`)
          ],
          internalNotes
        }
      })

      workerLogger.info("audit.stage.report-built", {
        ...context,
        findingCount: report.findings.length,
        model: usedModel
      })

      const evidencePack = {
        auditId: auditRun.id,
        profile: report.profile,
        verificationArtifacts,
        findingsEvidence: report.findings.map((finding) => ({
          findingId: finding.findingId,
          severity: finding.severity,
          filePath: finding.evidence.filePath,
          startLine: finding.evidence.startLine,
          endLine: finding.evidence.endLine,
          snippet: finding.evidence.snippet
        }))
      }

      await Promise.all([
        putObject({
          key: `audits/${auditRun.id}/agent-step-trace.json`,
          body: JSON.stringify(pipelineResult.stepTraces, null, 2),
          contentType: "application/json"
        }),
        putObject({
          key: `audits/${auditRun.id}/quality-gates.json`,
          body: JSON.stringify(report.qualityGates, null, 2),
          contentType: "application/json"
        }),
        putObject({
          key: `audits/${auditRun.id}/taxonomy-coverage.json`,
          body: JSON.stringify(report.taxonomySummary, null, 2),
          contentType: "application/json"
        }),
        putObject({
          key: `audits/${auditRun.id}/normalized-evidence-pack.json`,
          body: JSON.stringify(evidencePack, null, 2),
          contentType: "application/json"
        }),
        putObject({
          key: `audits/${auditRun.id}/report-v2.json`,
          body: JSON.stringify(report, null, 2),
          contentType: "application/json"
        })
      ])

      await db
        .update(auditRuns)
        .set({
          status: "completed",
          reportJson: report,
          finishedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(auditRuns.id, auditRun.id))

      workerLogger.info("audit.stage.audit-run-marked-completed", context)

      for (const finding of report.findings) {
        const stableFingerprint =
          finding.findingId ||
          createFindingFingerprint({
            title: finding.title,
            filePath: finding.evidence.filePath,
            startLine: finding.evidence.startLine,
            endLine: finding.evidence.endLine,
            severity: finding.severity
          })

        const [findingRecord] = await db
          .insert(findings)
          .values({
            projectId: auditRun.projectId,
            stableFingerprint,
            firstSeenRevisionId: auditRun.revisionId,
            lastSeenRevisionId: auditRun.revisionId,
            currentStatus: "opened"
          })
          .onConflictDoUpdate({
            target: [findings.projectId, findings.stableFingerprint],
            set: {
              lastSeenRevisionId: auditRun.revisionId,
              updatedAt: new Date()
            }
          })
          .returning()

        if (!findingRecord) {
          throw new Error("Failed to create finding record")
        }

        await db
          .insert(findingInstances)
          .values({
            findingId: findingRecord.id,
            auditRunId: auditRun.id,
            revisionId: auditRun.revisionId,
            severity: finding.severity,
            payloadJson: finding
          })
          .onConflictDoUpdate({
            target: [findingInstances.findingId, findingInstances.auditRunId],
            set: {
              severity: finding.severity,
              payloadJson: finding
            }
          })
      }

      workerLogger.info("audit.stage.findings-persisted", {
        ...context,
        findingCount: report.findings.length
      })

      const [previousAudit] = await db
        .select()
        .from(auditRuns)
        .where(
          and(
            eq(auditRuns.projectId, auditRun.projectId),
            eq(auditRuns.status, "completed"),
            sql`${auditRuns.createdAt} < ${auditRun.createdAt}`
          )
        )
        .orderBy(desc(auditRuns.createdAt))
        .limit(1)

      await deps.enqueueJob(
        "finding-lifecycle",
        {
          projectId: auditRun.projectId,
          auditRunId: auditRun.id,
          previousAuditRunId: previousAudit?.id ?? null
        },
        `finding-lifecycle:${auditRun.projectId}:${auditRun.id}`
      )

      workerLogger.info("audit.stage.finding-lifecycle-enqueued", {
        ...context,
        previousAuditRunId: previousAudit?.id ?? null
      })

      await recordJobEvent({
        projectId: job.data.projectId,
        queue: "audit",
        jobId: String(job.id),
        event: "completed",
        payload: {
          auditRunId: auditRun.id,
          findingCount: report.findings.length,
          model: usedModel
        }
      })

      workerLogger.info("audit.stage.completed", {
        ...context,
        findingCount: report.findings.length,
        model: usedModel
      })

      return { auditRunId: auditRun.id, findingCount: report.findings.length }
    } catch (error) {
      const normalizedError = normalizeModelError(error)

      await db
        .update(auditRuns)
        .set({
          status: "failed",
          finishedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(auditRuns.id, auditRun.id))

      await recordJobEvent({
        projectId: job.data.projectId,
        queue: "audit",
        jobId: String(job.id),
        event: "failed",
        payload: {
          auditRunId: auditRun.id,
          message: normalizedError.message
        }
      })

      workerLogger.error("audit.stage.failed", {
        ...context,
        error: normalizedError.details
      })

      if (error instanceof Error) {
        throw error
      }

      throw new Error(normalizedError.message)
    }
  }
}
