import type { Job } from "bullmq";

import type { JobPayloadMap } from "@ton-audit/shared";

export type EnqueueJob = <Name extends keyof JobPayloadMap>(
  step: Name,
  payload: JobPayloadMap[Name],
  jobId: string
) => Promise<unknown>;

export type JobProcessor<Name extends keyof JobPayloadMap> = (
  job: Job<JobPayloadMap[Name], unknown, Name>
) => Promise<unknown>;
