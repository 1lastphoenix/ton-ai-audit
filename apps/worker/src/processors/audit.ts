import { embed, generateText, Output } from "ai";
import { Job } from "bullmq";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  auditFindingSchema,
  auditRuns,
  auditReportSchema,
  createFindingFingerprint,
  docsChunks,
  docsSources,
  findingInstances,
  findings,
  type JobPayloadMap,
  verificationSteps
} from "@ton-audit/shared";

import { db } from "../db";
import { env } from "../env";
import { recordJobEvent } from "../job-events";
import { workerLogger } from "../logger";
import { openrouter } from "../openrouter";
import { loadRevisionFilesWithContent } from "../revision-files";
import { putObject } from "../s3";
import type { EnqueueJob } from "./types";

type RetrievedDocChunk = {
  chunkId: string;
  sourceUrl: string;
  chunkText: string;
};

type NormalizedModelError = {
  message: string;
  details: {
    name: string;
    message: string;
    stack?: string;
    statusCode?: number;
    isRetryable?: boolean;
    url?: string;
    providerMessage?: string;
    providerCode?: string;
    responseBodySnippet?: string;
  };
  isRetryable: boolean | null;
};

const generatedAuditSchema = z.object({
  overview: z.string().min(1),
  methodology: z.string().min(1),
  scope: z.array(z.string()).min(1),
  findings: z.array(auditFindingSchema),
  verificationNotes: z.array(z.string()).default([])
});

const fallbackDocsUrls = [
  "https://docs.ton.org/contract-dev/blueprint/overview",
  "https://docs.ton.org/languages/tolk/overview",
  "https://docs.ton.org/languages/func/overview",
  "https://docs.ton.org/languages/tact/overview",
  "https://docs.ton.org/languages/fift/overview",
  "https://docs.ton.org/languages/tl-b/overview"
];

async function retrieveDocChunks(query: string): Promise<RetrievedDocChunk[]> {
  const queryTerms = query.slice(0, 10_000);
  const lexicalRows = await db.execute(sql`
    SELECT dc.id::text as chunk_id, ds.source_url, dc.chunk_text
    FROM docs_chunks dc
    INNER JOIN docs_sources ds ON ds.id = dc.source_id
    WHERE dc.lexemes @@ websearch_to_tsquery('english', ${queryTerms})
    ORDER BY ts_rank_cd(dc.lexemes, websearch_to_tsquery('english', ${queryTerms})) DESC
    LIMIT 8
  `);

  const lexicalChunks = (lexicalRows as unknown as { rows: Array<Record<string, unknown>> }).rows
    .map((row) => ({
      chunkId: String(row.chunk_id),
      sourceUrl: String(row.source_url),
      chunkText: String(row.chunk_text)
    }))
    .filter((row) => row.chunkId && row.sourceUrl && row.chunkText);

  let semanticChunks: RetrievedDocChunk[] = [];
  try {
    const { embedding } = await embed({
      model: openrouter.textEmbeddingModel(env.OPENROUTER_EMBEDDINGS_MODEL),
      value: queryTerms.slice(0, 2_500)
    });

    const vectorLiteral = `[${embedding.join(",")}]`;
    const semanticRows = await db.execute(sql`
      SELECT dc.id::text as chunk_id, ds.source_url, dc.chunk_text
      FROM docs_chunks dc
      INNER JOIN docs_sources ds ON ds.id = dc.source_id
      ORDER BY dc.embedding <=> ${vectorLiteral}::vector
      LIMIT 8
    `);

    semanticChunks = (semanticRows as unknown as { rows: Array<Record<string, unknown>> }).rows
      .map((row) => ({
        chunkId: String(row.chunk_id),
        sourceUrl: String(row.source_url),
        chunkText: String(row.chunk_text)
      }))
      .filter((row) => row.chunkId && row.sourceUrl && row.chunkText);
  } catch {
    semanticChunks = [];
  }

  const mergedById = new Map<string, RetrievedDocChunk>();
  for (const chunk of lexicalChunks) {
    mergedById.set(chunk.chunkId, chunk);
  }
  for (const chunk of semanticChunks) {
    if (!mergedById.has(chunk.chunkId)) {
      mergedById.set(chunk.chunkId, chunk);
    }
  }

  const merged = [...mergedById.values()].slice(0, 8);
  if (merged.length >= 5) {
    return merged;
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
    .limit(8);

  const fallbackChunks = fallbackRows.map((row) => ({
    chunkId: row.chunkId,
    sourceUrl: row.sourceUrl,
    chunkText: row.chunkText
  }));

  const withFallback = [...merged, ...fallbackChunks];
  const deduped = new Map<string, RetrievedDocChunk>();
  for (const chunk of withFallback) {
    if (!deduped.has(chunk.chunkId)) {
      deduped.set(chunk.chunkId, chunk);
    }
  }

  return [...deduped.values()].slice(0, 8);
}

async function fetchFallbackDocs(): Promise<RetrievedDocChunk[]> {
  const chunks: RetrievedDocChunk[] = [];

  for (const sourceUrl of fallbackDocsUrls.slice(0, 4)) {
    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) {
        continue;
      }

      const body = await response.text();
      const text = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2_200);
      if (!text) {
        continue;
      }

      chunks.push({
        chunkId: `fallback:${sourceUrl}`,
        sourceUrl,
        chunkText: text
      });
    } catch {
      // Ignore fallback source failures to keep audits resilient.
    }
  }

  return chunks;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function truncateForLog(value: string, max = 500) {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max)}...`;
}

function extractProviderErrorDetails(params: { responseBody?: string; data?: unknown }) {
  let providerMessage: string | null = null;
  let providerCode: string | null = null;
  let responseBodySnippet: string | null = null;

  if (isRecord(params.data)) {
    const node = isRecord(params.data.error) ? params.data.error : params.data;
    if (typeof node.message === "string" && node.message.trim()) {
      providerMessage = node.message.trim();
    }
    if (typeof node.code === "string" && node.code.trim()) {
      providerCode = node.code.trim();
    }
  }

  if (params.responseBody && params.responseBody.trim()) {
    const raw = params.responseBody.trim();
    responseBodySnippet = truncateForLog(raw, 1_200);

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isRecord(parsed)) {
        const node = isRecord(parsed.error) ? parsed.error : parsed;
        if (!providerMessage && typeof node.message === "string" && node.message.trim()) {
          providerMessage = node.message.trim();
        }
        if (!providerCode && typeof node.code === "string" && node.code.trim()) {
          providerCode = node.code.trim();
        }
      }
    } catch {
      // Keep raw snippet when response body is not JSON.
    }
  }

  return {
    providerMessage,
    providerCode,
    responseBodySnippet
  };
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
    };
  }

  const apiError = error as Error & {
    statusCode?: unknown;
    isRetryable?: unknown;
    url?: unknown;
    responseBody?: unknown;
    data?: unknown;
  };

  const statusCode = typeof apiError.statusCode === "number" ? apiError.statusCode : undefined;
  const isRetryable =
    typeof apiError.isRetryable === "boolean" ? apiError.isRetryable : null;
  const url = typeof apiError.url === "string" ? apiError.url : undefined;
  const responseBody =
    typeof apiError.responseBody === "string" ? apiError.responseBody : undefined;

  const providerDetails = extractProviderErrorDetails({
    responseBody,
    data: apiError.data
  });

  const messageParts = [error.message];
  if (statusCode !== undefined) {
    messageParts.push(`status ${statusCode}`);
  }
  if (providerDetails.providerMessage && providerDetails.providerMessage !== error.message) {
    messageParts.push(providerDetails.providerMessage);
  }

  const details: NormalizedModelError["details"] = {
    name: error.name,
    message: error.message
  };

  if (error.stack) {
    details.stack = error.stack;
  }
  if (statusCode !== undefined) {
    details.statusCode = statusCode;
  }
  if (isRetryable !== null) {
    details.isRetryable = isRetryable;
  }
  if (url) {
    details.url = url;
  }
  if (providerDetails.providerMessage) {
    details.providerMessage = providerDetails.providerMessage;
  }
  if (providerDetails.providerCode) {
    details.providerCode = providerDetails.providerCode;
  }
  if (providerDetails.responseBodySnippet) {
    details.responseBodySnippet = providerDetails.responseBodySnippet;
  }

  return {
    message: messageParts.join(" | "),
    details,
    isRetryable
  };
}

function assembleAuditPrompt(params: {
  files: Awaited<ReturnType<typeof loadRevisionFilesWithContent>>;
  verificationSummary: string;
  docs: RetrievedDocChunk[];
}) {
  const filesText = params.files
    .map((file) => `FILE: ${file.path}\n\`\`\`\n${file.content.slice(0, 8_000)}\n\`\`\``)
    .join("\n\n");

  const docsText = params.docs
    .map(
      (chunk) =>
        `SOURCE: ${chunk.sourceUrl} (chunk:${chunk.chunkId})\n${chunk.chunkText.slice(0, 2_000)}`
    )
    .join("\n\n");

  return [
    "Audit the TON smart-contract codebase using a professional security-report style.",
    "Prioritize deterministic evidence and include file paths and line ranges.",
    "Supported ecosystem languages: Tolk, FunC, Tact, Fift, TL-B.",
    "",
    "Verification summary:",
    params.verificationSummary || "No verification summary available.",
    "",
    "Codebase:",
    filesText,
    "",
    "Knowledge base context:",
    docsText || "No indexed documentation context available."
  ].join("\n");
}

function ensureCitations(
  finding: z.infer<typeof auditFindingSchema>,
  docs: RetrievedDocChunk[]
): z.infer<typeof auditFindingSchema> {
  const references = [...finding.references];
  if (!references.length && docs.length > 0) {
    references.push(docs[0]!.sourceUrl);
  }

  return {
    ...finding,
    references
  };
}

export function createAuditProcessor(deps: { enqueueJob: EnqueueJob }) {
  return async function audit(job: Job<JobPayloadMap["audit"]>) {
    const context = {
      queue: "audit",
      jobId: String(job.id),
      projectId: job.data.projectId,
      revisionId: job.data.revisionId,
      auditRunId: job.data.auditRunId
    };

    workerLogger.info("audit.stage.started", context);

    await recordJobEvent({
      projectId: job.data.projectId,
      queue: "audit",
      jobId: String(job.id),
      event: "started",
      payload: { data: job.data }
    });

    const auditRun = await db.query.auditRuns.findFirst({
      where: and(eq(auditRuns.id, job.data.auditRunId), eq(auditRuns.projectId, job.data.projectId))
    });

    if (!auditRun) {
      throw new Error("Audit run not found");
    }

    workerLogger.info("audit.stage.audit-run-found", {
      ...context,
      runStatus: auditRun.status,
      includeDocsFallbackFetch: job.data.includeDocsFallbackFetch
    });

    try {
      const files = await loadRevisionFilesWithContent(job.data.revisionId);
      if (!files.length) {
        throw new Error("Revision has no files to audit");
      }

      const verifyRows = await db.query.verificationSteps.findMany({
        where: eq(verificationSteps.auditRunId, auditRun.id)
      });

      const verificationSummary = verifyRows
        .map((row) => `[${row.status}] ${row.stepType}: ${row.summary ?? "No summary"}`)
        .join("\n");

      workerLogger.info("audit.stage.inputs-loaded", {
        ...context,
        fileCount: files.length,
        verificationStepCount: verifyRows.length
      });

      const retrievalQuery = files
        .slice(0, 20)
        .map((file) => `${file.path} ${file.content.slice(0, 200)}`)
        .join("\n");

      let docs = await retrieveDocChunks(retrievalQuery);
      if (docs.length === 0 && job.data.includeDocsFallbackFetch) {
        workerLogger.info("audit.stage.docs-fallback-requested", context);
        docs = await fetchFallbackDocs();
      }

      workerLogger.info("audit.stage.docs-loaded", {
        ...context,
        docsCount: docs.length
      });

      const prompt = assembleAuditPrompt({
        files,
        verificationSummary,
        docs
      });

      const systemPrompt = [
        "You are an elite TON blockchain security auditor.",
        "Return only high-confidence findings with concrete evidence.",
        "Use severity scale critical/high/medium/low/informational.",
        "Every finding must include exploit path and remediation."
      ].join(" ");

      const tryModel = async (modelId: string) =>
        generateText({
          model: openrouter(modelId),
          output: Output.object({ schema: generatedAuditSchema }),
          system: systemPrompt,
          prompt
        });

      const runModelWithRetry = async (modelId: string, stage: "primary" | "fallback") => {
        const maxAttempts = 2;
        let lastError: unknown = null;
        let lastNormalizedError: NormalizedModelError | null = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            if (attempt > 1) {
              workerLogger.info("audit.stage.model-retry-attempt", {
                ...context,
                stage,
                modelId,
                attempt
              });
            }

            return await tryModel(modelId);
          } catch (error) {
            lastError = error;
            const normalizedError = normalizeModelError(error);
            lastNormalizedError = normalizedError;

            workerLogger.warn("audit.stage.model-attempt-failed", {
              ...context,
              stage,
              modelId,
              attempt,
              error: normalizedError.details
            });

            if (normalizedError.isRetryable === false) {
              workerLogger.info("audit.stage.model-retry-skipped", {
                ...context,
                stage,
                modelId,
                attempt,
                reason: "provider-marked-non-retryable",
                statusCode: normalizedError.details.statusCode
              });
              break;
            }

            if (attempt < maxAttempts) {
              await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
            }
          }
        }

        if (lastError instanceof Error) {
          throw lastError;
        }

        throw new Error(lastNormalizedError?.message ?? "Model invocation failed");
      };

      let modelResult: Awaited<ReturnType<typeof tryModel>>;
      let usedModel = auditRun.primaryModelId;

      workerLogger.info("audit.stage.model-primary-started", {
        ...context,
        modelId: auditRun.primaryModelId
      });

      try {
        modelResult = await runModelWithRetry(auditRun.primaryModelId, "primary");
        workerLogger.info("audit.stage.model-primary-completed", {
          ...context,
          modelId: auditRun.primaryModelId
        });
      } catch (primaryError) {
        const normalizedPrimaryError = normalizeModelError(primaryError);
        workerLogger.warn("audit.stage.model-primary-failed", {
          ...context,
          modelId: auditRun.primaryModelId,
          error: normalizedPrimaryError.details
        });

        usedModel = auditRun.fallbackModelId;
        workerLogger.info("audit.stage.model-fallback-started", {
          ...context,
          modelId: auditRun.fallbackModelId
        });

        modelResult = await runModelWithRetry(auditRun.fallbackModelId, "fallback");
        workerLogger.info("audit.stage.model-fallback-completed", {
          ...context,
          modelId: auditRun.fallbackModelId
        });

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
        });
      }

      const normalizedFindings = modelResult.output.findings.map((finding) =>
        ensureCitations(finding, docs)
      );

      const severityTotals = normalizedFindings.reduce<Record<string, number>>((acc, finding) => {
        acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
        return acc;
      }, {});

      const report = auditReportSchema.parse({
        auditId: auditRun.id,
        projectId: auditRun.projectId,
        revisionId: auditRun.revisionId,
        generatedAt: new Date().toISOString(),
        model: {
          used: usedModel,
          primary: auditRun.primaryModelId,
          fallback: auditRun.fallbackModelId
        },
        summary: {
          overview: modelResult.output.overview,
          methodology: modelResult.output.methodology,
          scope: modelResult.output.scope,
          severityTotals
        },
        findings: normalizedFindings,
        appendix: {
          references: [...new Set(docs.map((item) => item.sourceUrl))],
          verificationNotes: modelResult.output.verificationNotes
        }
      });

      workerLogger.info("audit.stage.report-built", {
        ...context,
        findingCount: report.findings.length,
        model: usedModel
      });

      await Promise.all([
        putObject({
          key: `audits/${auditRun.id}/prompt.txt`,
          body: prompt,
          contentType: "text/plain; charset=utf-8"
        }),
        putObject({
          key: `audits/${auditRun.id}/model-result.json`,
          body: JSON.stringify(
            {
              model: usedModel,
              finishReason: modelResult.finishReason,
              usage: modelResult.usage,
              response: modelResult.response,
              object: modelResult.output
            },
            null,
            2
          ),
          contentType: "application/json"
        })
      ]);

      await db
        .update(auditRuns)
        .set({
          status: "completed",
          reportJson: report,
          finishedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(auditRuns.id, auditRun.id));

      workerLogger.info("audit.stage.audit-run-marked-completed", context);

      for (const finding of report.findings) {
        const stableFingerprint =
          finding.findingId ||
          createFindingFingerprint({
            title: finding.title,
            filePath: finding.evidence.filePath,
            startLine: finding.evidence.startLine,
            endLine: finding.evidence.endLine,
            severity: finding.severity
          });

        let findingRecord = await db.query.findings.findFirst({
          where: and(
            eq(findings.projectId, auditRun.projectId),
            eq(findings.stableFingerprint, stableFingerprint)
          )
        });

        if (!findingRecord) {
          const [createdFinding] = await db
            .insert(findings)
            .values({
              projectId: auditRun.projectId,
              stableFingerprint,
              firstSeenRevisionId: auditRun.revisionId,
              lastSeenRevisionId: auditRun.revisionId,
              currentStatus: "opened"
            })
            .returning();

          if (!createdFinding) {
            throw new Error("Failed to create finding record");
          }

          findingRecord = createdFinding;
        } else {
          await db
            .update(findings)
            .set({
              lastSeenRevisionId: auditRun.revisionId,
              updatedAt: new Date()
            })
            .where(eq(findings.id, findingRecord.id));
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
          });
      }

      workerLogger.info("audit.stage.findings-persisted", {
        ...context,
        findingCount: report.findings.length
      });

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
        .limit(1);

      await deps.enqueueJob(
        "finding-lifecycle",
        {
          projectId: auditRun.projectId,
          auditRunId: auditRun.id,
          previousAuditRunId: previousAudit?.id ?? null
        },
        `finding-lifecycle:${auditRun.projectId}:${auditRun.id}`
      );

      workerLogger.info("audit.stage.finding-lifecycle-enqueued", {
        ...context,
        previousAuditRunId: previousAudit?.id ?? null
      });

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
      });

      workerLogger.info("audit.stage.completed", {
        ...context,
        findingCount: report.findings.length,
        model: usedModel
      });

      return { auditRunId: auditRun.id, findingCount: report.findings.length };
    } catch (error) {
      const normalizedError = normalizeModelError(error);

      await db
        .update(auditRuns)
        .set({
          status: "failed",
          finishedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(auditRuns.id, auditRun.id));

      await recordJobEvent({
        projectId: job.data.projectId,
        queue: "audit",
        jobId: String(job.id),
        event: "failed",
        payload: {
          auditRunId: auditRun.id,
          message: normalizedError.message
        }
      });

      workerLogger.error("audit.stage.failed", {
        ...context,
        error: normalizedError.details
      });

      if (error instanceof Error) {
        throw error;
      }

      throw new Error(normalizedError.message);
    }
  };
}
