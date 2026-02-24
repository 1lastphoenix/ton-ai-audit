import { createServer } from "node:http";

import { Queue, Worker, type Job } from "bullmq";
import { sql } from "drizzle-orm";

import {
  DEFAULT_AUDIT_TIMEOUT_MS,
  type JobPayloadMap,
  queueConcurrency,
  queueNames,
  type JobStep
} from "@ton-audit/shared";

import { db, pool } from "./db";
import { redisConnection } from "./redis";
import { createAuditProcessor } from "./processors/audit";
import { createCleanupProcessor } from "./processors/cleanup";
import { createDocsCrawlProcessor } from "./processors/docs-crawl";
import { createDocsIndexProcessor } from "./processors/docs-index";
import { createFindingLifecycleProcessor } from "./processors/finding-lifecycle";
import { createIngestProcessor } from "./processors/ingest";
import { toBullMqJobId } from "./job-id";
import { workerLogger } from "./logger";
import { createPdfProcessor } from "./processors/pdf";
import { createVerifyProcessor } from "./processors/verify";
import { recordJobEvent } from "./job-events";

const queues = {
  ingest: new Queue<JobPayloadMap["ingest"]>(queueNames.ingest, { connection: redisConnection }),
  verify: new Queue<JobPayloadMap["verify"]>(queueNames.verify, { connection: redisConnection }),
  audit: new Queue<JobPayloadMap["audit"]>(queueNames.audit, { connection: redisConnection }),
  findingLifecycle: new Queue<JobPayloadMap["finding-lifecycle"]>(queueNames.findingLifecycle, {
    connection: redisConnection
  }),
  pdf: new Queue<JobPayloadMap["pdf"]>(queueNames.pdf, { connection: redisConnection }),
  docsCrawl: new Queue<JobPayloadMap["docs-crawl"]>(queueNames.docsCrawl, {
    connection: redisConnection
  }),
  docsIndex: new Queue<JobPayloadMap["docs-index"]>(queueNames.docsIndex, {
    connection: redisConnection
  }),
  cleanup: new Queue<JobPayloadMap["cleanup"]>(queueNames.cleanup, { connection: redisConnection })
} as const;

function extractPayloadContext(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const data = payload as Record<string, unknown>;
  const context: Record<string, unknown> = {};

  if (typeof data.projectId === "string") {
    context.projectId = data.projectId;
  }
  if (typeof data.revisionId === "string") {
    context.revisionId = data.revisionId;
  }
  if (typeof data.auditRunId === "string") {
    context.auditRunId = data.auditRunId;
  }
  if (typeof data.previousAuditRunId === "string") {
    context.previousAuditRunId = data.previousAuditRunId;
  }
  if (typeof data.sourceId === "string") {
    context.sourceId = data.sourceId;
  }

  return context;
}

function extractJobContext(job: Job<Record<string, unknown>, unknown, string> | undefined) {
  if (!job) {
    return {
      queue: "unknown",
      jobName: "unknown",
      jobId: "unknown"
    };
  }

  return {
    queue: job.queueName,
    jobName: job.name,
    jobId: String(job.id),
    attempt: job.attemptsMade + 1,
    ...extractPayloadContext(job.data)
  };
}

async function enqueueJob<Name extends keyof JobPayloadMap>(
  step: Name,
  payload: JobPayloadMap[Name],
  jobId: string
) {
  const safeJobId = toBullMqJobId(jobId);
  const context = {
    queue: step,
    requestedJobId: jobId,
    bullMqJobId: safeJobId,
    ...extractPayloadContext(payload)
  };

  workerLogger.info("queue.enqueue.requested", context);

  try {
    switch (step) {
      case "ingest": {
        const enqueued = await queues.ingest.add(step, payload as JobPayloadMap["ingest"], {
          jobId: safeJobId
        });
        workerLogger.info("queue.enqueue.accepted", { ...context, enqueuedJobId: String(enqueued.id) });
        return enqueued;
      }
      case "verify": {
        const enqueued = await queues.verify.add(step, payload as JobPayloadMap["verify"], {
          jobId: safeJobId
        });
        workerLogger.info("queue.enqueue.accepted", { ...context, enqueuedJobId: String(enqueued.id) });
        return enqueued;
      }
      case "audit": {
        const enqueued = await queues.audit.add(step, payload as JobPayloadMap["audit"], {
          jobId: safeJobId
        });
        workerLogger.info("queue.enqueue.accepted", { ...context, enqueuedJobId: String(enqueued.id) });
        return enqueued;
      }
      case "finding-lifecycle": {
        const enqueued = await queues.findingLifecycle.add(
          step,
          payload as JobPayloadMap["finding-lifecycle"],
          {
            jobId: safeJobId
          }
        );
        workerLogger.info("queue.enqueue.accepted", { ...context, enqueuedJobId: String(enqueued.id) });
        return enqueued;
      }
      case "pdf": {
        const enqueued = await queues.pdf.add(step, payload as JobPayloadMap["pdf"], { jobId: safeJobId });
        workerLogger.info("queue.enqueue.accepted", { ...context, enqueuedJobId: String(enqueued.id) });
        return enqueued;
      }
      case "docs-crawl": {
        const enqueued = await queues.docsCrawl.add(step, payload as JobPayloadMap["docs-crawl"], {
          jobId: safeJobId
        });
        workerLogger.info("queue.enqueue.accepted", { ...context, enqueuedJobId: String(enqueued.id) });
        return enqueued;
      }
      case "docs-index": {
        const enqueued = await queues.docsIndex.add(step, payload as JobPayloadMap["docs-index"], {
          jobId: safeJobId
        });
        workerLogger.info("queue.enqueue.accepted", { ...context, enqueuedJobId: String(enqueued.id) });
        return enqueued;
      }
      case "cleanup": {
        const enqueued = await queues.cleanup.add(step, payload as JobPayloadMap["cleanup"], {
          jobId: safeJobId
        });
        workerLogger.info("queue.enqueue.accepted", { ...context, enqueuedJobId: String(enqueued.id) });
        return enqueued;
      }
      default:
        throw new Error(`Unsupported queue step: ${String(step)}`);
    }
  } catch (error) {
    workerLogger.error("queue.enqueue.failed", {
      ...context,
      error
    });
    throw error;
  }
}

async function runWithTimeout<T>(handler: () => Promise<T>, timeoutMs = DEFAULT_AUDIT_TIMEOUT_MS) {
  let timeoutHandle: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Job timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([handler(), timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function createWorker<Name extends JobStep>(
  queueName: Name,
  processor: (job: Job<JobPayloadMap[Name], unknown, Name>) => Promise<unknown>,
  concurrency: number
) {
  return new Worker<JobPayloadMap[Name], unknown, Name>(
    queueName,
    async (job) => {
      const startedAt = Date.now();
      const context = extractJobContext(job as unknown as Job<Record<string, unknown>, unknown, string>);

      workerLogger.info("worker.job.started", context);

      try {
        const result = await runWithTimeout(() => processor(job));
        workerLogger.info("worker.job.completed", {
          ...context,
          durationMs: Date.now() - startedAt
        });
        return result;
      } catch (error) {
        workerLogger.error("worker.job.failed", {
          ...context,
          durationMs: Date.now() - startedAt,
          error
        });
        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency
    }
  );
}

const ingestProcessor = createIngestProcessor({ enqueueJob });
const verifyProcessor = createVerifyProcessor({ enqueueJob });
const auditProcessor = createAuditProcessor({ enqueueJob });
const findingLifecycleProcessor = createFindingLifecycleProcessor();
const pdfProcessor = createPdfProcessor();
const docsCrawlProcessor = createDocsCrawlProcessor({ enqueueJob });
const docsIndexProcessor = createDocsIndexProcessor();
const cleanupProcessor = createCleanupProcessor();

const workers = [
  createWorker("ingest", ingestProcessor, queueConcurrency.ingest),
  createWorker("verify", verifyProcessor, queueConcurrency.verify),
  createWorker("audit", auditProcessor, queueConcurrency.audit),
  createWorker("finding-lifecycle", findingLifecycleProcessor, queueConcurrency.findingLifecycle),
  createWorker("pdf", pdfProcessor, queueConcurrency.pdf),
  createWorker("docs-crawl", docsCrawlProcessor, queueConcurrency.docsCrawl),
  createWorker("docs-index", docsIndexProcessor, queueConcurrency.docsIndex),
  createWorker("cleanup", cleanupProcessor, queueConcurrency.cleanup)
];

const healthPort = Number(process.env.WORKER_HEALTH_PORT || 3010);
const healthServer = createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "worker",
        now: new Date().toISOString()
      })
    );
    return;
  }

  if (req.url === "/readyz") {
    try {
      await db.execute(sql`select 1`);
      await redisConnection.ping();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: true,
          service: "worker",
          now: new Date().toISOString()
        })
      );
    } catch (error) {
      res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: false,
          service: "worker",
          error: error instanceof Error ? error.message : "Unknown readiness error"
        })
      );
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Not found" }));
});

for (const worker of workers) {
  worker.on("active", (job) => {
    workerLogger.info("worker.event.active", extractJobContext(job));
  });

  worker.on("completed", async (job, result) => {
    const context = extractJobContext(job);
    workerLogger.info("worker.event.completed", context);

    try {
      await recordJobEvent({
        projectId: (job?.data as { projectId?: string } | undefined)?.projectId ?? null,
        queue: worker.name,
        jobId: String(job?.id ?? "unknown"),
        event: "worker-completed",
        payload: (result as Record<string, unknown>) ?? {}
      });
    } catch (error) {
      workerLogger.error("worker.event.completed.record-failed", {
        ...context,
        error
      });
    }
  });

  worker.on("failed", async (job, error) => {
    const context = extractJobContext(job);
    workerLogger.error("worker.event.failed", {
      ...context,
      error
    });

    try {
      await recordJobEvent({
        projectId: (job?.data as { projectId?: string } | undefined)?.projectId ?? null,
        queue: worker.name,
        jobId: String(job?.id ?? "unknown"),
        event: "worker-failed",
        payload: {
          message: error.message
        }
      });
    } catch (recordError) {
      workerLogger.error("worker.event.failed.record-failed", {
        ...context,
        error: recordError
      });
    }
  });

  worker.on("stalled", (jobId) => {
    workerLogger.warn("worker.event.stalled", {
      queue: worker.name,
      jobId: String(jobId)
    });
  });

  worker.on("error", (error) => {
    workerLogger.error("worker.event.error", {
      queue: worker.name,
      error
    });
  });
}

async function bootstrap() {
  workerLogger.info("bootstrap.started");
  await enqueueJob(
    "docs-crawl",
    {
      seedSitemapUrl: "https://docs.ton.org/sitemap.xml"
    },
    "docs-crawl:bootstrap"
  );
  workerLogger.info("bootstrap.docs-crawl.enqueued");

  await queues.cleanup.add(
    "cleanup",
    {
      dryRun: false
    },
    {
      jobId: toBullMqJobId("cleanup:scheduled"),
      repeat: {
        every: 24 * 60 * 60 * 1000
      }
    }
  );
  workerLogger.info("bootstrap.cleanup-schedule.enqueued");
}

async function shutdown() {
  workerLogger.info("shutdown.started");
  await new Promise<void>((resolve) => {
    healthServer.close(() => resolve());
  });
  await Promise.all(workers.map((worker) => worker.close()));
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
  await redisConnection.quit();
  await pool.end();
  workerLogger.info("shutdown.completed");
}

bootstrap().catch((error) => {
  workerLogger.error("bootstrap.failed", { error });
});

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});

healthServer.listen(healthPort, () => {
  workerLogger.info("health-server.listening", { port: healthPort });
});

workerLogger.info("workers.started", { workerCount: workers.length });
