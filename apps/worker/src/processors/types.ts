import type { JobPayloadMap } from "@ton-audit/shared";

export type EnqueueJob = <Name extends keyof JobPayloadMap>(
  step: Name,
  payload: JobPayloadMap[Name],
  jobId: string
) => Promise<unknown>;
