import path from "node:path";

import { Job } from "bullmq";
import unzipper from "unzipper";
import { and, eq } from "drizzle-orm";

import {
  auditRuns,
  detectLanguageFromPath,
  normalizePath,
  revisions,
  type JobPayloadMap,
  uploads
} from "@ton-audit/shared";

import { validateArchiveEntries } from "../archive";
import { db } from "../db";
import { env } from "../env";
import { recordJobEvent } from "../job-events";
import { getObjectBuffer } from "../s3";
import { clearRevisionFiles, upsertRevisionFile } from "../revision-files";
import type { EnqueueJob } from "./types";

type ArchiveFile = {
  path: string;
  sizeBytes: number;
  content: string;
};

async function loadArchiveFiles(buffer: Buffer): Promise<ArchiveFile[]> {
  const opened = await unzipper.Open.buffer(buffer);
  const rawEntries = opened.files.filter((file) => file.type === "File");

  const validatedEntries = validateArchiveEntries(
    rawEntries.map((file) => ({
      path: file.path,
      sizeBytes: Math.max(file.uncompressedSize ?? 0, 0)
    })),
    {
      maxFiles: env.UPLOAD_MAX_FILES,
      maxBytes: env.UPLOAD_MAX_BYTES
    }
  );

  const contentByPath = new Map<string, Buffer>();
  for (const entry of rawEntries) {
    const normalized = normalizePath(entry.path);
    if (!validatedEntries.some((item) => item.normalizedPath === normalized)) {
      continue;
    }
    contentByPath.set(normalized, await entry.buffer());
  }

  return validatedEntries.map((item) => ({
    path: item.normalizedPath,
    sizeBytes: item.sizeBytes,
    content: (contentByPath.get(item.normalizedPath) ?? Buffer.from("")).toString("utf8")
  }));
}

function buildSingleUploadFile(params: {
  originalFilename: string;
  content: Buffer;
}): ArchiveFile {
  const normalizedPath = normalizePath(params.originalFilename);
  const filename = normalizedPath || path.basename(params.originalFilename) || "uploaded.txt";

  return {
    path: filename,
    sizeBytes: params.content.byteLength,
    content: params.content.toString("utf8")
  };
}

export function createIngestProcessor(deps: { enqueueJob: EnqueueJob }) {
  return async function ingest(job: Job<JobPayloadMap["ingest"]>) {
    await recordJobEvent({
      queue: "ingest",
      jobId: String(job.id),
      event: "started",
      payload: { data: job.data }
    });

    const upload = await db.query.uploads.findFirst({
      where: and(eq(uploads.id, job.data.uploadId), eq(uploads.projectId, job.data.projectId))
    });

    if (!upload) {
      throw new Error("Upload not found");
    }

    const revision = await db.query.revisions.findFirst({
      where: and(eq(revisions.id, job.data.revisionId), eq(revisions.projectId, job.data.projectId))
    });

    if (!revision) {
      throw new Error("Revision not found");
    }

    await db
      .update(uploads)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(uploads.id, upload.id));

    try {
      const payloadBuffer = await getObjectBuffer(upload.s3Key);
      if (!payloadBuffer) {
        throw new Error("Upload payload not found in object storage");
      }

      const files =
        upload.type === "zip"
          ? await loadArchiveFiles(payloadBuffer)
          : [buildSingleUploadFile({ originalFilename: upload.originalFilename, content: payloadBuffer })];

      if (!files.length) {
        throw new Error("No supported source files found in upload");
      }

      await clearRevisionFiles(revision.id);

      for (const file of files) {
        const normalizedPath = normalizePath(file.path);
        await upsertRevisionFile({
          revisionId: revision.id,
          path: normalizedPath,
          language: detectLanguageFromPath(normalizedPath),
          isTestFile: /(^|\/)(test|tests|__tests__)\/|\.spec\./i.test(normalizedPath),
          content: file.content
        });
      }

      let auditRun = await db.query.auditRuns.findFirst({
        where: and(eq(auditRuns.projectId, revision.projectId), eq(auditRuns.revisionId, revision.id))
      });

      if (!auditRun) {
        const [created] = await db
          .insert(auditRuns)
          .values({
            projectId: revision.projectId,
            revisionId: revision.id,
            status: "queued",
            requestedByUserId: job.data.requestedByUserId,
            primaryModelId: env.AUDIT_MODEL_ALLOWLIST[0] ?? "openai/gpt-5",
            fallbackModelId:
              env.AUDIT_MODEL_ALLOWLIST[1] ??
              env.AUDIT_MODEL_ALLOWLIST[0] ??
              "openai/gpt-5-mini"
          })
          .returning();

        if (!created) {
          throw new Error("Failed to create audit run");
        }

        auditRun = created;
      }

      await db
        .update(uploads)
        .set({
          status: "processed",
          updatedAt: new Date()
        })
        .where(eq(uploads.id, upload.id));

      await deps.enqueueJob(
        "verify",
        {
          projectId: revision.projectId,
          revisionId: revision.id,
          auditRunId: auditRun.id,
          includeDocsFallbackFetch: true
        },
        `verify:${revision.projectId}:${auditRun.id}`
      );

      await recordJobEvent({
        queue: "ingest",
        jobId: String(job.id),
        event: "completed",
        payload: {
          revisionId: revision.id,
          auditRunId: auditRun.id,
          fileCount: files.length
        }
      });

      return { revisionId: revision.id, auditRunId: auditRun.id, fileCount: files.length };
    } catch (error) {
      await db
        .update(uploads)
        .set({
          status: "failed",
          updatedAt: new Date()
        })
        .where(eq(uploads.id, upload.id));

      await recordJobEvent({
        queue: "ingest",
        jobId: String(job.id),
        event: "failed",
        payload: {
          uploadId: upload.id,
          message: error instanceof Error ? error.message : "Unknown ingest failure"
        }
      });

      throw error;
    }
  };
}
