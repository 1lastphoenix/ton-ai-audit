import { Queue } from "bullmq";

import {
  type JobPayloadMap,
  jobStepSchema,
  queueNames,
  type JobStep
} from "@ton-audit/shared";

import { getRedisConnection } from "./redis";

type QueueMap = {
  ingest: Queue<JobPayloadMap["ingest"]>;
  verify: Queue<JobPayloadMap["verify"]>;
  audit: Queue<JobPayloadMap["audit"]>;
  findingLifecycle: Queue<JobPayloadMap["finding-lifecycle"]>;
  pdf: Queue<JobPayloadMap["pdf"]>;
  docsCrawl: Queue<JobPayloadMap["docs-crawl"]>;
  docsIndex: Queue<JobPayloadMap["docs-index"]>;
  cleanup: Queue<JobPayloadMap["cleanup"]>;
};

let queueCache: QueueMap | null = null;
const BULLMQ_RESERVED_SEPARATOR = ":";
const BULLMQ_SAFE_SEPARATOR = "__";

function toBullMqJobId(jobId: string) {
  return jobId.replaceAll(BULLMQ_RESERVED_SEPARATOR, BULLMQ_SAFE_SEPARATOR);
}

function createQueue<Name extends JobStep>(name: Name) {
  return new Queue<JobPayloadMap[Name]>(name, {
    connection: getRedisConnection(),
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

function buildQueues(): QueueMap {
  return {
    ingest: createQueue(queueNames.ingest),
    verify: createQueue(queueNames.verify),
    audit: createQueue(queueNames.audit),
    findingLifecycle: createQueue(queueNames.findingLifecycle),
    pdf: createQueue(queueNames.pdf),
    docsCrawl: createQueue(queueNames.docsCrawl),
    docsIndex: createQueue(queueNames.docsIndex),
    cleanup: createQueue(queueNames.cleanup)
  };
}

function getQueues(): QueueMap {
  if (queueCache) {
    return queueCache;
  }

  queueCache = buildQueues();
  return queueCache;
}

export const queues = new Proxy({} as QueueMap, {
  get(_target, property) {
    return Reflect.get(getQueues(), property);
  }
});

function getOperatorQueue(step: JobStep) {
  const current = getQueues();

  switch (step) {
    case "ingest":
      return current.ingest;
    case "verify":
      return current.verify;
    case "audit":
      return current.audit;
    case "finding-lifecycle":
      return current.findingLifecycle;
    case "pdf":
      return current.pdf;
    case "docs-crawl":
      return current.docsCrawl;
    case "docs-index":
      return current.docsIndex;
    case "cleanup":
      return current.cleanup;
  }
}

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
  const safeJobId = toBullMqJobId(jobId);
  const current = getQueues();

  switch (step) {
    case "ingest":
      return current.ingest.add(step, payload as JobPayloadMap["ingest"], { jobId: safeJobId });
    case "verify":
      return current.verify.add(step, payload as JobPayloadMap["verify"], { jobId: safeJobId });
    case "audit":
      return current.audit.add(step, payload as JobPayloadMap["audit"], { jobId: safeJobId });
    case "finding-lifecycle":
      return current.findingLifecycle.add(step, payload as JobPayloadMap["finding-lifecycle"], {
        jobId: safeJobId
      });
    case "pdf":
      return current.pdf.add(step, payload as JobPayloadMap["pdf"], { jobId: safeJobId });
    case "docs-crawl":
      return current.docsCrawl.add(step, payload as JobPayloadMap["docs-crawl"], { jobId: safeJobId });
    case "docs-index":
      return current.docsIndex.add(step, payload as JobPayloadMap["docs-index"], { jobId: safeJobId });
    case "cleanup":
      return current.cleanup.add(step, payload as JobPayloadMap["cleanup"], { jobId: safeJobId });
    default:
      throw new Error(`Unsupported queue step: ${String(step)}`);
  }
}

export async function listDeadLetterJobs(limitPerQueue = 20) {
  const steps = jobStepSchema.options;
  const failed: Array<{
    queue: JobStep;
    jobId: string;
    name: string;
    failedReason: string | null;
    attemptsMade: number;
    timestamp: number;
    finishedOn: number | null;
    data: Record<string, unknown>;
  }> = [];

  for (const step of steps) {
    const queue = getOperatorQueue(step);
    const jobs = await queue.getJobs(["failed"], 0, Math.max(limitPerQueue - 1, 0), true);
    for (const job of jobs) {
      failed.push({
        queue: step,
        jobId: String(job.id),
        name: job.name,
        failedReason: job.failedReason ?? null,
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp ?? 0,
        finishedOn: job.finishedOn ?? null,
        data: (job.data ?? {}) as Record<string, unknown>
      });
    }
  }

  return failed.sort((a, b) => (b.finishedOn ?? b.timestamp) - (a.finishedOn ?? a.timestamp));
}

export async function replayDeadLetterJob(step: JobStep, jobId: string) {
  const queue = getOperatorQueue(step);
  const job = await queue.getJob(jobId);
  if (!job) {
    throw new Error("Failed job not found");
  }

  const isFailed = await job.isFailed();
  if (!isFailed) {
    throw new Error("Only failed jobs can be replayed");
  }

  await job.retry();

  return {
    queue: step,
    jobId: String(job.id)
  };
}
