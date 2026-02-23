import { Job } from "bullmq";
import { and, eq, lt } from "drizzle-orm";

import {
  jobEvents,
  pdfExports,
  type JobPayloadMap,
  uploads
} from "@ton-audit/shared";

import { db } from "../db";
import { env } from "../env";
import { recordJobEvent } from "../job-events";
import { deleteObject } from "../s3";

export function createCleanupProcessor() {
  return async function cleanup(job: Job<JobPayloadMap["cleanup"]>) {
    await recordJobEvent({
      queue: "cleanup",
      jobId: String(job.id),
      event: "started",
      payload: { dryRun: job.data.dryRun ?? false }
    });

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - env.RETENTION_DAYS);

    const expiredPdfs = await db.query.pdfExports.findMany({
      where: and(eq(pdfExports.status, "completed"), lt(pdfExports.generatedAt, cutoff))
    });

    const staleUploads = await db.query.uploads.findMany({
      where: lt(uploads.createdAt, cutoff)
    });

    if (!job.data.dryRun) {
      for (const item of expiredPdfs) {
        if (item.s3Key) {
          await deleteObject(item.s3Key);
        }
      }

      for (const upload of staleUploads) {
        await deleteObject(upload.s3Key);
      }

      await db.delete(pdfExports).where(lt(pdfExports.createdAt, cutoff));
      await db.delete(uploads).where(lt(uploads.createdAt, cutoff));
      await db.delete(jobEvents).where(lt(jobEvents.createdAt, cutoff));
    }

    await recordJobEvent({
      queue: "cleanup",
      jobId: String(job.id),
      event: "completed",
      payload: {
        dryRun: job.data.dryRun ?? false,
        deletedPdfCount: expiredPdfs.length,
        deletedUploadCount: staleUploads.length
      }
    });

    return {
      dryRun: job.data.dryRun ?? false,
      deletedPdfCount: expiredPdfs.length,
      deletedUploadCount: staleUploads.length
    };
  };
}
