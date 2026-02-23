import { Job } from "bullmq";
import { and, eq, inArray } from "drizzle-orm";

import {
  auditRuns,
  findingInstances,
  findingTransitions,
  findings,
  type JobPayloadMap
} from "@ton-audit/shared";

import { db } from "../db";
import { recordJobEvent } from "../job-events";
import { computeFindingTransitions } from "./finding-lifecycle-core";

export function createFindingLifecycleProcessor() {
  return async function findingLifecycle(job: Job<JobPayloadMap["finding-lifecycle"]>) {
    await recordJobEvent({
      projectId: job.data.projectId,
      queue: "finding-lifecycle",
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

    const currentInstances = await db.query.findingInstances.findMany({
      where: eq(findingInstances.auditRunId, auditRun.id)
    });

    const previousInstances = job.data.previousAuditRunId
      ? await db.query.findingInstances.findMany({
          where: eq(findingInstances.auditRunId, job.data.previousAuditRunId)
        })
      : [];

    const relevantFindingIds = [
      ...new Set([
        ...previousInstances.map((instance) => instance.findingId),
        ...currentInstances.map((instance) => instance.findingId)
      ])
    ];

    const previousStatusesByFindingId: Record<string, "opened" | "resolved"> = {};
    const priorFindings = relevantFindingIds.length
      ? await db.query.findings.findMany({
          where: inArray(findings.id, relevantFindingIds)
        })
      : [];

    for (const finding of priorFindings) {
      if (finding.currentStatus === "resolved") {
        previousStatusesByFindingId[finding.id] = "resolved";
      } else {
        previousStatusesByFindingId[finding.id] = "opened";
      }
    }

    const transitions = computeFindingTransitions({
      previousFindingIds: previousInstances.map((instance) => instance.findingId),
      currentFindingIds: currentInstances.map((instance) => instance.findingId),
      previousStatusesByFindingId
    });

    for (const transitionEntry of transitions) {
      const { findingId, transition, currentStatus } = transitionEntry;

      if (job.data.previousAuditRunId) {
        await db.insert(findingTransitions).values({
          findingId,
          fromAuditRunId: job.data.previousAuditRunId,
          toAuditRunId: auditRun.id,
          transition
        });
      }

      if (currentStatus === "opened") {
        await db
          .update(findings)
          .set({
            currentStatus: "opened",
            lastSeenRevisionId: auditRun.revisionId,
            updatedAt: new Date()
          })
          .where(eq(findings.id, findingId));
      } else if (currentStatus === "resolved") {
        await db
          .update(findings)
          .set({
            currentStatus: "resolved",
            updatedAt: new Date()
          })
          .where(eq(findings.id, findingId));
      }
    }

    await recordJobEvent({
      projectId: job.data.projectId,
      queue: "finding-lifecycle",
      jobId: String(job.id),
      event: "completed",
      payload: {
        auditRunId: auditRun.id,
        currentFindings: currentInstances.length,
        previousFindings: previousInstances.length
      }
    });

    return {
      auditRunId: auditRun.id,
      currentFindings: currentInstances.length,
      previousFindings: previousInstances.length
    };
  };
}
