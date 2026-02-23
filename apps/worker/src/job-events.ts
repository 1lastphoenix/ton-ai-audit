import { jobEvents } from "@ton-audit/shared";

import { db } from "./db";

export async function recordJobEvent(params: {
  queue: string;
  jobId: string;
  event: string;
  payload?: Record<string, unknown>;
}) {
  await db.insert(jobEvents).values({
    queue: params.queue,
    jobId: params.jobId,
    event: params.event,
    payload: params.payload ?? {}
  });
}
