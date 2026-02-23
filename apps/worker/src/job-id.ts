const BULLMQ_RESERVED_SEPARATOR = ":";
const BULLMQ_SAFE_SEPARATOR = "__";

export function toBullMqJobId(jobId: string) {
  return jobId.replaceAll(BULLMQ_RESERVED_SEPARATOR, BULLMQ_SAFE_SEPARATOR);
}
