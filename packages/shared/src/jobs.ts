import { z } from "zod";

export const ingestJobPayloadSchema = z.object({
  projectId: z.string().uuid(),
  revisionId: z.string().uuid(),
  uploadId: z.string().uuid(),
  requestedByUserId: z.string().min(1)
});

export const verifyJobPayloadSchema = z.object({
  projectId: z.string().uuid(),
  revisionId: z.string().uuid(),
  auditRunId: z.string().uuid(),
  includeDocsFallbackFetch: z.boolean().default(true)
});

export const auditJobPayloadSchema = z.object({
  projectId: z.string().uuid(),
  revisionId: z.string().uuid(),
  auditRunId: z.string().uuid(),
  includeDocsFallbackFetch: z.boolean().default(true)
});

export const findingLifecycleJobPayloadSchema = z.object({
  projectId: z.string().uuid(),
  auditRunId: z.string().uuid(),
  previousAuditRunId: z.string().uuid().nullable()
});

export const pdfJobPayloadSchema = z.object({
  projectId: z.string().uuid(),
  auditRunId: z.string().uuid(),
  requestedByUserId: z.string().min(1)
});

export const docsCrawlJobPayloadSchema = z.object({
  seedSitemapUrl: z.string().url()
});

export const docsIndexJobPayloadSchema = z.object({
  sourceId: z.string().uuid()
});

export const cleanupJobPayloadSchema = z.object({
  dryRun: z.boolean().optional()
});

export const jobPayloadSchemas = {
  ingest: ingestJobPayloadSchema,
  verify: verifyJobPayloadSchema,
  audit: auditJobPayloadSchema,
  "finding-lifecycle": findingLifecycleJobPayloadSchema,
  pdf: pdfJobPayloadSchema,
  "docs-crawl": docsCrawlJobPayloadSchema,
  "docs-index": docsIndexJobPayloadSchema,
  cleanup: cleanupJobPayloadSchema
} as const;

export type JobPayloadMap = {
  ingest: z.infer<typeof ingestJobPayloadSchema>;
  verify: z.infer<typeof verifyJobPayloadSchema>;
  audit: z.infer<typeof auditJobPayloadSchema>;
  "finding-lifecycle": z.infer<typeof findingLifecycleJobPayloadSchema>;
  pdf: z.infer<typeof pdfJobPayloadSchema>;
  "docs-crawl": z.infer<typeof docsCrawlJobPayloadSchema>;
  "docs-index": z.infer<typeof docsIndexJobPayloadSchema>;
  cleanup: z.infer<typeof cleanupJobPayloadSchema>;
};
