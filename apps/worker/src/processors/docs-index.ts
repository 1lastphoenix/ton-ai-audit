import { embedMany } from "ai";
import { Job } from "bullmq";
import { eq, sql } from "drizzle-orm";
import { load } from "cheerio";

import {
  createContentFingerprint,
  docsChunks,
  docsSources,
  type JobPayloadMap
} from "@ton-audit/shared";

import { db } from "../db";
import { env } from "../env";
import { recordJobEvent } from "../job-events";
import { openrouter } from "../openrouter";

type Chunk = {
  chunkText: string;
  tokenCount: number;
};

function htmlToText(rawHtml: string) {
  const $ = load(rawHtml);
  $("script,style,noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function chunkText(input: string, maxChars = 2_500): Chunk[] {
  const chunks: Chunk[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const next = input.slice(cursor, cursor + maxChars).trim();
    if (!next) {
      break;
    }

    chunks.push({
      chunkText: next,
      tokenCount: Math.max(Math.round(next.length / 4), 1)
    });

    cursor += maxChars;
  }

  return chunks;
}

export function createDocsIndexProcessor() {
  return async function docsIndex(job: Job<JobPayloadMap["docs-index"]>) {
    await recordJobEvent({
      queue: "docs-index",
      jobId: String(job.id),
      event: "started",
      payload: { data: job.data }
    });

    const source = await db.query.docsSources.findFirst({
      where: eq(docsSources.id, job.data.sourceId)
    });

    if (!source) {
      throw new Error("Docs source not found");
    }

    const response = await fetch(source.sourceUrl);
    if (!response.ok) {
      throw new Error(`Unable to fetch docs source ${source.sourceUrl}`);
    }

    const body = await response.text();
    const checksum = createContentFingerprint(body);

    if (checksum === source.checksum) {
      await recordJobEvent({
        queue: "docs-index",
        jobId: String(job.id),
        event: "completed",
        payload: {
          sourceId: source.id,
          chunks: 0,
          skipped: true
        }
      });

      return { sourceId: source.id, chunks: 0, skipped: true };
    }

    const text = source.sourceType === "github" ? body : htmlToText(body);
    const chunks = chunkText(text);

    await db.delete(docsChunks).where(eq(docsChunks.sourceId, source.id));

    if (chunks.length > 0) {
      const values = chunks.map((chunk) => chunk.chunkText);
      const { embeddings } = await embedMany({
        model: openrouter.textEmbeddingModel(env.OPENROUTER_EMBEDDINGS_MODEL),
        values,
        maxParallelCalls: 2
      });

      await db.insert(docsChunks).values(
        chunks.map((chunk, index) => ({
          sourceId: source.id,
          chunkIndex: index,
          chunkText: chunk.chunkText,
          tokenCount: chunk.tokenCount,
          embedding: embeddings[index] ?? [],
          lexemes: null
        }))
      );

      await db.execute(sql`
        UPDATE docs_chunks
        SET lexemes = to_tsvector('english', chunk_text)
        WHERE source_id = ${source.id}
      `);
    }

    await db
      .update(docsSources)
      .set({
        checksum,
        title: source.title,
        fetchedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(docsSources.id, source.id));

    await recordJobEvent({
      queue: "docs-index",
      jobId: String(job.id),
      event: "completed",
      payload: {
        sourceId: source.id,
        chunks: chunks.length
      }
    });

    return { sourceId: source.id, chunks: chunks.length };
  };
}
