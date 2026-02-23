import { Queue } from "bullmq";

import {
  type JobPayloadMap,
  queueNames,
  type JobStep
} from "@ton-audit/shared";

import { redisConnection } from "./redis";

function createQueue<Name extends JobStep>(name: Name) {
  return new Queue<JobPayloadMap[Name]>(name, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      removeOnComplete: 1000,
      removeOnFail: 1000,
      backoff: {
        type: "exponential",
        delay: 5_000
      }
    }
  });
}

export const queues = {
  ingest: createQueue(queueNames.ingest),
  verify: createQueue(queueNames.verify),
  audit: createQueue(queueNames.audit),
  findingLifecycle: createQueue(queueNames.findingLifecycle),
  pdf: createQueue(queueNames.pdf),
  docsCrawl: createQueue(queueNames.docsCrawl),
  docsIndex: createQueue(queueNames.docsIndex),
  cleanup: createQueue(queueNames.cleanup)
} as const;

export function enqueueJob(
  step: "ingest",
  payload: JobPayloadMap["ingest"],
  jobId: string
): Promise<Awaited<ReturnType<typeof queues.ingest.add>>>;
export function enqueueJob(
  step: "verify",
  payload: JobPayloadMap["verify"],
  jobId: string
): Promise<Awaited<ReturnType<typeof queues.verify.add>>>;
export function enqueueJob(
  step: "audit",
  payload: JobPayloadMap["audit"],
  jobId: string
): Promise<Awaited<ReturnType<typeof queues.audit.add>>>;
export function enqueueJob(
  step: "finding-lifecycle",
  payload: JobPayloadMap["finding-lifecycle"],
  jobId: string
): Promise<Awaited<ReturnType<typeof queues.findingLifecycle.add>>>;
export function enqueueJob(
  step: "pdf",
  payload: JobPayloadMap["pdf"],
  jobId: string
): Promise<Awaited<ReturnType<typeof queues.pdf.add>>>;
export function enqueueJob(
  step: "docs-crawl",
  payload: JobPayloadMap["docs-crawl"],
  jobId: string
): Promise<Awaited<ReturnType<typeof queues.docsCrawl.add>>>;
export function enqueueJob(
  step: "docs-index",
  payload: JobPayloadMap["docs-index"],
  jobId: string
): Promise<Awaited<ReturnType<typeof queues.docsIndex.add>>>;
export function enqueueJob(
  step: "cleanup",
  payload: JobPayloadMap["cleanup"],
  jobId: string
): Promise<Awaited<ReturnType<typeof queues.cleanup.add>>>;
export async function enqueueJob(
  step: keyof JobPayloadMap,
  payload: JobPayloadMap[keyof JobPayloadMap],
  jobId: string
) {
  switch (step) {
    case "ingest":
      return queues.ingest.add(step, payload as JobPayloadMap["ingest"], { jobId });
    case "verify":
      return queues.verify.add(step, payload as JobPayloadMap["verify"], { jobId });
    case "audit":
      return queues.audit.add(step, payload as JobPayloadMap["audit"], { jobId });
    case "finding-lifecycle":
      return queues.findingLifecycle.add(step, payload as JobPayloadMap["finding-lifecycle"], { jobId });
    case "pdf":
      return queues.pdf.add(step, payload as JobPayloadMap["pdf"], { jobId });
    case "docs-crawl":
      return queues.docsCrawl.add(step, payload as JobPayloadMap["docs-crawl"], { jobId });
    case "docs-index":
      return queues.docsIndex.add(step, payload as JobPayloadMap["docs-index"], { jobId });
    case "cleanup":
      return queues.cleanup.add(step, payload as JobPayloadMap["cleanup"], { jobId });
    default:
      throw new Error(`Unsupported queue step: ${String(step)}`);
  }
}
