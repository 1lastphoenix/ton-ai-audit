import { Job } from "bullmq";
import { and, eq, inArray, lt, sql } from "drizzle-orm";

import {
  auditRuns,
  fileBlobs,
  jobEvents,
  pdfExports,
  revisions,
  type JobPayloadMap,
  verificationSteps,
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

    const staleVerificationSteps = await db.query.verificationSteps.findMany({
      where: lt(verificationSteps.createdAt, cutoff)
    });

    const staleAudits = await db.query.auditRuns.findMany({
      where: lt(auditRuns.createdAt, cutoff)
    });

    const staleRevisions = await db.query.revisions.findMany({
      where: lt(revisions.createdAt, cutoff)
    });

    const staleBlobRows = await db.execute(sql`
      SELECT fb.id, fb.s3_key
      FROM file_blobs fb
      LEFT JOIN revision_files rf ON rf.blob_id = fb.id
      WHERE rf.blob_id IS NULL
        AND fb.created_at < ${cutoff}
    `);

    const staleBlobs = (staleBlobRows as unknown as { rows: Array<{ id: string; s3_key: string }> }).rows;

    if (!job.data.dryRun) {
      for (const item of expiredPdfs) {
        if (item.s3Key) {
          await deleteObject(item.s3Key);
        }
      }

      for (const upload of staleUploads) {
        await deleteObject(upload.s3Key);
      }

      for (const step of staleVerificationSteps) {
        if (step.stdoutKey) {
          await deleteObject(step.stdoutKey);
        }
        if (step.stderrKey) {
          await deleteObject(step.stderrKey);
        }
      }

      for (const audit of staleAudits) {
        await deleteObject(`audits/${audit.id}/prompt.txt`);
        await deleteObject(`audits/${audit.id}/model-result.json`);
        await deleteObject(`audits/${audit.id}/primary-error.json`);
      }

      for (const blob of staleBlobs) {
        await deleteObject(blob.s3_key);
      }

      await db.delete(pdfExports).where(lt(pdfExports.createdAt, cutoff));
      await db.delete(uploads).where(lt(uploads.createdAt, cutoff));
      await db.delete(verificationSteps).where(lt(verificationSteps.createdAt, cutoff));
      await db.delete(auditRuns).where(lt(auditRuns.createdAt, cutoff));
      await db.delete(revisions).where(lt(revisions.createdAt, cutoff));
      if (staleBlobs.length > 0) {
        await db.delete(fileBlobs).where(
          inArray(
            fileBlobs.id,
            staleBlobs.map((item) => item.id)
          )
        );
      }
      await db.delete(jobEvents).where(lt(jobEvents.createdAt, cutoff));
    }

    await recordJobEvent({
      queue: "cleanup",
      jobId: String(job.id),
      event: "completed",
      payload: {
        dryRun: job.data.dryRun ?? false,
        deletedPdfCount: expiredPdfs.length,
        deletedUploadCount: staleUploads.length,
        deletedVerificationArtifactCount: staleVerificationSteps.length,
        deletedAuditCount: staleAudits.length,
        deletedRevisionCount: staleRevisions.length,
        deletedBlobCount: staleBlobs.length
      }
    });

    return {
      dryRun: job.data.dryRun ?? false,
      deletedPdfCount: expiredPdfs.length,
      deletedUploadCount: staleUploads.length,
      deletedVerificationArtifactCount: staleVerificationSteps.length,
      deletedAuditCount: staleAudits.length,
      deletedRevisionCount: staleRevisions.length,
      deletedBlobCount: staleBlobs.length
    };
  };
}
