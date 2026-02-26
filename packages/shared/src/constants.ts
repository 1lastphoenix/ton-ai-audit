import { z } from "zod";

import {
  auditProfileSchema,
  languageSchema,
  pdfExportVariantSchema,
  severitySchema,
  uploadTypeSchema
} from "./enums";

export const DEFAULT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const DEFAULT_UPLOAD_MAX_FILES = 300;
export const DEFAULT_RETENTION_DAYS = 90;
export const DEFAULT_AUDIT_TIMEOUT_MS = 20 * 60 * 1000;

export const queueNames = {
  ingest: "ingest",
  verify: "verify",
  audit: "audit",
  findingLifecycle: "finding-lifecycle",
  pdf: "pdf",
  docsCrawl: "docs-crawl",
  docsIndex: "docs-index",
  cleanup: "cleanup",
} as const;

export const queueConcurrency = {
  ingest: 5,
  verify: 4,
  audit: 3,
  findingLifecycle: 3,
  pdf: 2,
  docsCrawl: 2,
  docsIndex: 2,
  cleanup: 1,
} as const;

export const acceptedUploadExtensions = [
  ".tolk",
  ".fc",
  ".func",
  ".tact",
  ".fif",
  ".fift",
  ".tlb",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".js",
  ".lock",
  ".xml",
  ".zip",
] as const;

export const topLevelDocsPrefixes = [
  "/contract-dev/blueprint/",
  "/contract-dev/testing/",
  "/languages/tolk/",
  "/languages/func/",
  "/languages/tact/",
  "/languages/fift/",
  "/languages/tl-b/",
] as const;

export const findingEvidenceSchema = z.object({
  filePath: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  snippet: z.string().min(1),
});

export const findingTaxonomyReferenceSchema = z.object({
  standard: z.enum(["owasp-sc", "cwe", "swc"]),
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  url: z.string().url().optional()
});

export const cvssV31Schema = z.object({
  vector: z.string().min(1),
  baseScore: z.number().min(0).max(10),
  severity: z.enum(["none", "low", "medium", "high", "critical"]).optional(),
  exploitabilityScore: z.number().min(0).max(10).optional(),
  impactScore: z.number().min(0).max(10).optional()
});

export const fixPrioritySchema = z.enum(["p0", "p1", "p2", "p3"]);

export const auditFindingSchema = z.object({
  findingId: z.string().min(1),
  severity: severitySchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  impact: z.string().min(1),
  likelihood: z.string().min(1),
  evidence: findingEvidenceSchema,
  exploitPath: z.string().min(1),
  remediation: z.string().min(1),
  confidence: z.number().min(0).max(1),
  references: z.array(z.string().url()).default([]),
  language: languageSchema.optional(),
  taxonomy: z.array(findingTaxonomyReferenceSchema).default([]),
  cvssV31: cvssV31Schema.optional(),
  preconditions: z.array(z.string().min(1)).default([]),
  attackScenario: z.string().default(""),
  affectedContracts: z.array(z.string().min(1)).default([]),
  exploitability: z.string().default(""),
  businessImpact: z.string().default(""),
  technicalImpact: z.string().default(""),
  fixPriority: fixPrioritySchema.default("p2"),
  verificationPlan: z.array(z.string().min(1)).default([])
});

export type AuditFinding = z.infer<typeof auditFindingSchema>;

export const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  initialization: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("scaffold"),
      language: z.literal("tolk"),
    }),
    z.object({
      mode: z.literal("upload"),
    }),
  ]),
});

const uploadInitSingleFileSchema = z.object({
  type: z.literal("zip"),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  parts: z.number().int().positive().max(10_000).default(1),
});

const uploadInitFileSetFileSchema = z.object({
  path: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

const uploadInitFileSetSchema = z.object({
  type: z.literal("file-set"),
  files: z
    .array(uploadInitFileSetFileSchema)
    .min(1)
    .max(DEFAULT_UPLOAD_MAX_FILES),
  totalSizeBytes: z.number().int().positive(),
});

export const uploadInitSchema = z.union([
  uploadInitSingleFileSchema,
  uploadInitFileSetSchema,
]);

export const uploadCompleteSchema = z.object({
  uploadId: z.string().uuid(),
  eTags: z
    .array(
      z.object({
        partNumber: z.number().int().positive(),
        eTag: z.string().min(1),
      }),
    )
    .default([]),
  completedFiles: z
    .array(
      z.object({
        path: z.string().min(1),
        eTag: z.string().min(1).optional(),
      }),
    )
    .default([]),
});

export const createRevisionFromUploadSchema = z.object({
  uploadId: z.string().uuid(),
  explicitLanguageHints: z.record(z.string(), languageSchema).optional(),
});

export const workingCopyPatchFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  language: languageSchema.optional(),
  isTestFile: z.boolean().optional(),
});

export const runAuditSchema = z.object({
  primaryModelId: z.string().min(1),
  fallbackModelId: z.string().min(1),
  profile: auditProfileSchema.default("deep"),
  includeDocsFallbackFetch: z.boolean().default(true),
});

export const pdfExportRequestSchema = z.object({
  variant: pdfExportVariantSchema.default("internal")
});

export const reportBrandingSchema = z.object({
  reportTitle: z.string().min(1).default("TON Smart Contract Security Audit"),
  issuerName: z.string().min(1).default("TON Audit Platform"),
  issuerLogoUrl: z.string().url().optional(),
  primaryColor: z.string().min(1).default("#0f172a"),
  accentColor: z.string().min(1).default("#0ea5e9"),
  confidentialityNotice: z
    .string()
    .default("Confidential. For authorized recipients only."),
  legalDisclaimer: z
    .string()
    .default("This report is provided as-is and reflects findings at the time of assessment."),
  signatureLabel: z.string().default("Lead Security Reviewer"),
  signerName: z.string().default("Security Team")
});

export const docsCrawlSeedSchema = z.object({
  seedSitemapUrl: z.string().url(),
  allowPrefixes: z.array(z.string()).default([...topLevelDocsPrefixes]),
});

export const modelAllowlistSchema = z.object({
  models: z.array(z.string().min(1)).min(1),
});

export const envConfigSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PUBLIC_ENDPOINT: z.string().min(1).optional(),
  MINIO_REGION: z.string().default("us-east-1"),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_EMBEDDINGS_MODEL: z.string().min(1),
  AUDIT_MODEL_ALLOWLIST: z.string().default("google/gemini-2.5-flash"),
  ADMIN_EMAILS: z.string().default(""),
  SANDBOX_RUNNER_URL: z.string().url().default("http://localhost:3003"),
  NEXT_PUBLIC_TON_LSP_WS_URL: z.string().default("ws://localhost:3002"),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_UPLOAD_MAX_BYTES),
  UPLOAD_MAX_FILES: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_UPLOAD_MAX_FILES),
  RETENTION_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_RETENTION_DAYS),
});

export function parseModelAllowlist(value: string): string[] {
  const seen = new Set<string>();

  return value
    .split(",")
    .map((model) => model.trim())
    .filter((model) => {
      if (!model || seen.has(model)) {
        return false;
      }
      seen.add(model);
      return true;
    });
}

export function parseAdminEmails(value: string): string[] {
  return value
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
