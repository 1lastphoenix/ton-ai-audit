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

async function enqueueJob<Name extends keyof JobPayloadMap>(
  step: Name,
  payload: JobPayloadMap[Name],
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
    async (job) => runWithTimeout(() => processor(job)),
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
  worker.on("completed", async (job, result) => {
    await recordJobEvent({
      projectId: (job?.data as { projectId?: string } | undefined)?.projectId ?? null,
      queue: worker.name,
      jobId: String(job?.id ?? "unknown"),
      event: "worker-completed",
      payload: (result as Record<string, unknown>) ?? {}
    });
  });

  worker.on("failed", async (job, error) => {
    await recordJobEvent({
      projectId: (job?.data as { projectId?: string } | undefined)?.projectId ?? null,
      queue: worker.name,
      jobId: String(job?.id ?? "unknown"),
      event: "worker-failed",
      payload: {
        message: error.message
      }
    });
  });
}

async function bootstrap() {
  await enqueueJob(
    "docs-crawl",
    {
      seedSitemapUrl: "https://docs.ton.org/sitemap.xml"
    },
    "docs-crawl:bootstrap"
  );

  await queues.cleanup.add(
    "cleanup",
    {
      dryRun: false
    },
    {
      jobId: "cleanup:scheduled",
      repeat: {
        every: 24 * 60 * 60 * 1000
      }
    }
  );
}

async function shutdown() {
  await new Promise<void>((resolve) => {
    healthServer.close(() => resolve());
  });
  await Promise.all(workers.map((worker) => worker.close()));
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
  await redisConnection.quit();
  await pool.end();
}

bootstrap().catch((error) => {
  console.error("Worker bootstrap failed", error);
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
  console.log(`Worker health server listening on :${healthPort}`);
});

console.log("TON audit workers started");
