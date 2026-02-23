import { z } from "zod";

export const languageSchema = z.enum(["tolk", "func", "tact", "fift", "tl-b", "unknown"]);
export type Language = z.infer<typeof languageSchema>;

export const severitySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "informational"
]);
export type Severity = z.infer<typeof severitySchema>;

export const auditRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
]);
export type AuditRunStatus = z.infer<typeof auditRunStatusSchema>;

export const verificationStepStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "skipped"
]);
export type VerificationStepStatus = z.infer<typeof verificationStepStatusSchema>;

export const uploadTypeSchema = z.enum(["file-set", "zip"]);
export type UploadType = z.infer<typeof uploadTypeSchema>;

export const uploadStatusSchema = z.enum([
  "initialized",
  "uploaded",
  "processing",
  "processed",
  "failed"
]);
export type UploadStatus = z.infer<typeof uploadStatusSchema>;

export const revisionSourceSchema = z.enum(["upload", "working-copy"]);
export type RevisionSource = z.infer<typeof revisionSourceSchema>;

export const workingCopyStatusSchema = z.enum(["active", "locked", "discarded"]);
export type WorkingCopyStatus = z.infer<typeof workingCopyStatusSchema>;

export const findingTransitionSchema = z.enum(["opened", "resolved", "regressed", "unchanged"]);
export type FindingTransition = z.infer<typeof findingTransitionSchema>;

export const pdfExportStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export type PdfExportStatus = z.infer<typeof pdfExportStatusSchema>;

export const jobStepSchema = z.enum([
  "ingest",
  "verify",
  "audit",
  "finding-lifecycle",
  "pdf",
  "docs-crawl",
  "docs-index",
  "cleanup"
]);
export type JobStep = z.infer<typeof jobStepSchema>;