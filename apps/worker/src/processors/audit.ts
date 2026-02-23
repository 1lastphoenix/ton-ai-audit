import { generateObject } from "ai";
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
import { recordJobEvent } from "../job-events";
import { openrouter } from "../openrouter";
import { loadRevisionFilesWithContent } from "../revision-files";
import { putObject } from "../s3";
import type { EnqueueJob } from "./types";

type RetrievedDocChunk = {
  chunkId: string;
  sourceUrl: string;
  chunkText: string;
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

  if (lexicalChunks.length >= 5) {
    return lexicalChunks;
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

  return [...lexicalChunks, ...fallbackChunks].slice(0, 8);
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
    await recordJobEvent({
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

    const retrievalQuery = files
      .slice(0, 20)
      .map((file) => `${file.path} ${file.content.slice(0, 200)}`)
      .join("\n");
    let docs = await retrieveDocChunks(retrievalQuery);
    if (docs.length === 0 && job.data.includeDocsFallbackFetch) {
      docs = await fetchFallbackDocs();
    }
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
      generateObject({
        model: openrouter(modelId),
        schema: generatedAuditSchema,
        system: systemPrompt,
        prompt
      });

    let modelResult: Awaited<ReturnType<typeof tryModel>>;
    let usedModel = auditRun.primaryModelId;

    try {
      modelResult = await tryModel(auditRun.primaryModelId);
    } catch (primaryError) {
      usedModel = auditRun.fallbackModelId;
      modelResult = await tryModel(auditRun.fallbackModelId);

      await putObject({
        key: `audits/${auditRun.id}/primary-error.json`,
        body: JSON.stringify(
          {
            message: primaryError instanceof Error ? primaryError.message : "Unknown primary model error"
          },
          null,
          2
        ),
        contentType: "application/json"
      });
    }

    const normalizedFindings = modelResult.object.findings.map((finding) =>
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
        primary: auditRun.primaryModelId,
        fallback: auditRun.fallbackModelId
      },
      summary: {
        overview: modelResult.object.overview,
        methodology: modelResult.object.methodology,
        scope: modelResult.object.scope,
        severityTotals
      },
      findings: normalizedFindings,
      appendix: {
        references: [...new Set(docs.map((item) => item.sourceUrl))],
        verificationNotes: modelResult.object.verificationNotes
      }
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
            object: modelResult.object
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

      await recordJobEvent({
        queue: "audit",
        jobId: String(job.id),
        event: "completed",
        payload: {
          auditRunId: auditRun.id,
          findingCount: report.findings.length,
          model: usedModel
        }
      });

      return { auditRunId: auditRun.id, findingCount: report.findings.length };
    } catch (error) {
      await db
        .update(auditRuns)
        .set({
          status: "failed",
          finishedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(auditRuns.id, auditRun.id));

      await recordJobEvent({
        queue: "audit",
        jobId: String(job.id),
        event: "failed",
        payload: {
          auditRunId: auditRun.id,
          message: error instanceof Error ? error.message : "Unknown audit failure"
        }
      });

      throw error;
    }
  };
}
