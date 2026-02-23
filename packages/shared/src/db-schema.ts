import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import {
  auditRunStatusSchema,
  findingTransitionSchema,
  languageSchema,
  pdfExportStatusSchema,
  projectLifecycleStateSchema,
  revisionSourceSchema,
  uploadStatusSchema,
  uploadTypeSchema,
  verificationStepStatusSchema,
  workingCopyStatusSchema
} from "./enums";

const vectorType = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    const dimensions = config?.dimensions ?? 1536;
    return `vector(${dimensions})`;
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    if (Array.isArray(value)) {
      return value.map((item) => Number(item));
    }

    const trimmed = value.trim().replace(/^\[/, "").replace(/\]$/, "");
    if (!trimmed) {
      return [];
    }

    return trimmed.split(",").map((item) => Number(item));
  }
});

const toPgEnumValues = <T extends string>(values: readonly T[]) =>
  values as [T, ...T[]];

const tsvectorType = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return "tsvector";
  }
});

export const uploadTypeEnum = pgEnum("upload_type", toPgEnumValues(uploadTypeSchema.options));
export const uploadStatusEnum = pgEnum("upload_status", toPgEnumValues(uploadStatusSchema.options));
export const projectLifecycleStateEnum = pgEnum(
  "project_lifecycle_state",
  toPgEnumValues(projectLifecycleStateSchema.options)
);
export const revisionSourceEnum = pgEnum(
  "revision_source",
  toPgEnumValues(revisionSourceSchema.options)
);
export const workingCopyStatusEnum = pgEnum(
  "working_copy_status",
  toPgEnumValues(workingCopyStatusSchema.options)
);
export const auditRunStatusEnum = pgEnum(
  "audit_run_status",
  toPgEnumValues(auditRunStatusSchema.options)
);
export const verificationStepStatusEnum = pgEnum(
  "verification_step_status",
  toPgEnumValues(verificationStepStatusSchema.options)
);
export const findingTransitionEnum = pgEnum(
  "finding_transition",
  toPgEnumValues(findingTransitionSchema.options)
);
export const pdfExportStatusEnum = pgEnum(
  "pdf_export_status",
  toPgEnumValues(pdfExportStatusSchema.options)
);
export const languageEnum = pgEnum("language", toPgEnumValues(languageSchema.options));

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    emailUnique: unique("users_email_unique").on(table.email),
    emailIdx: index("users_email_idx").on(table.email)
  })
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    tokenUnique: unique("sessions_token_unique").on(table.token),
    userIdIdx: index("sessions_user_id_idx").on(table.userId)
  })
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    providerAccountUnique: unique("accounts_provider_account_unique").on(
      table.providerId,
      table.accountId
    ),
    userIdIdx: index("accounts_user_id_idx").on(table.userId)
  })
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    identifierIdx: index("verification_tokens_identifier_idx").on(table.identifier)
  })
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 140 }).notNull(),
    lifecycleState: projectLifecycleStateEnum("lifecycle_state").notNull().default("ready"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    ownerIdx: index("projects_owner_idx").on(table.ownerUserId),
    lifecycleIdx: index("projects_lifecycle_idx").on(table.lifecycleState),
    slugUnique: uniqueIndex("projects_owner_slug_active_unique")
      .on(table.ownerUserId, table.slug)
      .where(sql`${table.deletedAt} is null`)
  })
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 32 }).notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.userId] }),
    roleIdx: index("project_members_role_idx").on(table.role)
  })
);

export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    uploaderUserId: text("uploader_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: uploadTypeEnum("type").notNull(),
    status: uploadStatusEnum("status").notNull().default("initialized"),
    s3Key: text("s3_key").notNull(),
    multipartUploadId: text("multipart_upload_id"),
    sizeBytes: integer("size_bytes").notNull(),
    contentType: text("content_type").notNull(),
    originalFilename: text("original_filename").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    projectIdx: index("uploads_project_idx").on(table.projectId),
    statusIdx: index("uploads_status_idx").on(table.status)
  })
);

export const revisions = pgTable(
  "revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentRevisionId: uuid("parent_revision_id"),
    source: revisionSourceEnum("source").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isImmutable: boolean("is_immutable").notNull().default(true),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    projectIdx: index("revisions_project_idx").on(table.projectId),
    parentIdx: index("revisions_parent_idx").on(table.parentRevisionId)
  })
);

export const fileBlobs = pgTable(
  "file_blobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    s3Key: text("s3_key").notNull(),
    contentType: text("content_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    shaIdx: unique("file_blobs_sha_unique").on(table.sha256)
  })
);

export const revisionFiles = pgTable(
  "revision_files",
  {
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => revisions.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    language: languageEnum("language").notNull().default("unknown"),
    blobId: uuid("blob_id")
      .notNull()
      .references(() => fileBlobs.id, { onDelete: "cascade" }),
    isTestFile: boolean("is_test_file").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.revisionId, table.path] }),
    blobIdx: index("revision_files_blob_idx").on(table.blobId)
  })
);

export const workingCopies = pgTable(
  "working_copies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    baseRevisionId: uuid("base_revision_id")
      .notNull()
      .references(() => revisions.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: workingCopyStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    projectIdx: index("working_copies_project_idx").on(table.projectId),
    ownerIdx: index("working_copies_owner_idx").on(table.ownerUserId)
  })
);

export const workingCopyFiles = pgTable(
  "working_copy_files",
  {
    workingCopyId: uuid("working_copy_id")
      .notNull()
      .references(() => workingCopies.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    language: languageEnum("language").notNull().default("unknown"),
    content: text("content").notNull(),
    isTestFile: boolean("is_test_file").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workingCopyId, table.path] })
  })
);

export const auditRuns = pgTable(
  "audit_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => revisions.id, { onDelete: "cascade" }),
    status: auditRunStatusEnum("status").notNull().default("queued"),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    primaryModelId: text("primary_model_id").notNull(),
    fallbackModelId: text("fallback_model_id").notNull(),
    reportJson: jsonb("report_json").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    revisionIdx: index("audit_runs_revision_idx").on(table.revisionId),
    statusIdx: index("audit_runs_status_idx").on(table.status)
  })
);

export const verificationSteps = pgTable(
  "verification_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auditRunId: uuid("audit_run_id")
      .notNull()
      .references(() => auditRuns.id, { onDelete: "cascade" }),
    stepType: text("step_type").notNull(),
    toolchain: text("toolchain").notNull(),
    status: verificationStepStatusEnum("status").notNull().default("queued"),
    stdoutKey: text("stdout_key"),
    stderrKey: text("stderr_key"),
    summary: text("summary"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    auditRunIdx: index("verification_steps_audit_run_idx").on(table.auditRunId)
  })
);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    stableFingerprint: varchar("stable_fingerprint", { length: 64 }).notNull(),
    firstSeenRevisionId: uuid("first_seen_revision_id")
      .notNull()
      .references(() => revisions.id, { onDelete: "cascade" }),
    lastSeenRevisionId: uuid("last_seen_revision_id")
      .notNull()
      .references(() => revisions.id, { onDelete: "cascade" }),
    currentStatus: findingTransitionEnum("current_status").notNull().default("opened"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    projectFingerprintUnique: unique("findings_project_fingerprint_unique").on(
      table.projectId,
      table.stableFingerprint
    )
  })
);

export const findingInstances = pgTable(
  "finding_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    auditRunId: uuid("audit_run_id")
      .notNull()
      .references(() => auditRuns.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => revisions.id, { onDelete: "cascade" }),
    severity: text("severity").notNull(),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    findingAuditUnique: unique("finding_instances_finding_audit_unique").on(
      table.findingId,
      table.auditRunId
    ),
    auditRunIdx: index("finding_instances_audit_run_idx").on(table.auditRunId)
  })
);

export const findingTransitions = pgTable(
  "finding_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    fromAuditRunId: uuid("from_audit_run_id")
      .notNull()
      .references(() => auditRuns.id, { onDelete: "cascade" }),
    toAuditRunId: uuid("to_audit_run_id")
      .notNull()
      .references(() => auditRuns.id, { onDelete: "cascade" }),
    transition: findingTransitionEnum("transition").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    uniqueTransition: unique("finding_transitions_unique").on(
      table.findingId,
      table.fromAuditRunId,
      table.toAuditRunId
    )
  })
);

export const docsSources = pgTable(
  "docs_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceUrl: text("source_url").notNull(),
    sourceType: text("source_type").notNull().default("web"),
    checksum: varchar("checksum", { length: 64 }).notNull(),
    title: text("title"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    urlUnique: unique("docs_sources_url_unique").on(table.sourceUrl)
  })
);

export const docsChunks = pgTable(
  "docs_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => docsSources.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    chunkText: text("chunk_text").notNull(),
    tokenCount: integer("token_count").notNull(),
    embedding: vectorType("embedding", { dimensions: 1536 }).notNull(),
    lexemes: tsvectorType("lexemes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    sourceChunkUnique: unique("docs_chunks_source_chunk_unique").on(table.sourceId, table.chunkIndex),
    sourceIdx: index("docs_chunks_source_idx").on(table.sourceId)
  })
);

export const pdfExports = pgTable(
  "pdf_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auditRunId: uuid("audit_run_id")
      .notNull()
      .references(() => auditRuns.id, { onDelete: "cascade" }),
    status: pdfExportStatusEnum("status").notNull().default("queued"),
    s3Key: text("s3_key"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    auditUnique: unique("pdf_exports_audit_run_unique").on(table.auditRunId)
  })
);

export const systemSettings = pgTable(
  "system_settings",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  }
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    queue: text("queue").notNull(),
    jobId: text("job_id").notNull(),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    jobIdx: index("job_events_job_idx").on(table.jobId),
    projectJobIdx: index("job_events_project_job_idx").on(table.projectId, table.jobId)
  })
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Revision = typeof revisions.$inferSelect;
export type AuditRun = typeof auditRuns.$inferSelect;

export const dbSchema = {
  users,
  sessions,
  accounts,
  verificationTokens,
  projects,
  projectMembers,
  uploads,
  revisions,
  fileBlobs,
  revisionFiles,
  workingCopies,
  workingCopyFiles,
  auditRuns,
  verificationSteps,
  findings,
  findingInstances,
  findingTransitions,
  docsSources,
  docsChunks,
  pdfExports,
  systemSettings,
  jobEvents
};
