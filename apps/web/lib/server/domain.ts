import { randomUUID } from "node:crypto";

import {
  and,
  desc,
  eq,
  inArray,
  ne,
  sql
} from "drizzle-orm";

import {
  createContentFingerprint,
  detectLanguageFromPath,
  normalizePath,
  projectLifecycleStateSchema,
  type AuditProfile,
  type PdfExportStatus,
  type PdfExportVariant,
  type RevisionSource,
  type Language,
  type ProjectLifecycleState,
  projects,
  projectMembers,
  revisions,
  revisionFiles,
  uploads,
  workingCopies,
  workingCopyFiles,
  fileBlobs,
  auditRuns,
  findingInstances,
  findingTransitions,
  pdfExports
} from "@ton-audit/shared";

import { isUuid } from "@/lib/uuid";

import { db } from "./db";
import { getObjectText, putObject } from "./s3";

const FINAL_PDF_VARIANT: PdfExportVariant = "internal";

export async function ensureProjectAccess(projectId: string, userId: string) {
  if (!isUuid(projectId)) {
    return null;
  }

  const ownedProject = await db.query.projects.findFirst({
    where: and(
      eq(projects.id, projectId),
      eq(projects.ownerUserId, userId),
      ne(projects.lifecycleState, "deleted")
    )
  });

  if (ownedProject) {
    return ownedProject;
  }

  const membership = await db.query.projectMembers.findFirst({
    where: and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId))
  });

  if (!membership) {
    return null;
  }

  return db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), ne(projects.lifecycleState, "deleted"))
  });
}

export async function ensureProjectOwnerAccess(projectId: string, userId: string) {
  if (!isUuid(projectId)) {
    return null;
  }

  return db.query.projects.findFirst({
    where: and(
      eq(projects.id, projectId),
      eq(projects.ownerUserId, userId),
      ne(projects.lifecycleState, "deleted")
    )
  });
}

export async function ensureWorkingCopyAccess(
  workingCopyId: string,
  userId: string,
  projectId: string
) {
  if (!isUuid(workingCopyId) || !isUuid(projectId)) {
    return null;
  }

  return db.query.workingCopies.findFirst({
    where: and(
      eq(workingCopies.id, workingCopyId),
      eq(workingCopies.ownerUserId, userId),
      eq(workingCopies.projectId, projectId)
    )
  });
}

export async function createProject(input: {
  ownerUserId: string;
  name: string;
  slug: string;
  lifecycleState?: ProjectLifecycleState;
}) {
  const lifecycleState = input.lifecycleState ?? "ready";
  if (!projectLifecycleStateSchema.safeParse(lifecycleState).success) {
    throw new Error("Invalid project lifecycle state");
  }

  // Wrap project + member creation in a transaction so both succeed or both fail.
  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        ownerUserId: input.ownerUserId,
        name: input.name,
        slug: input.slug,
        lifecycleState
      })
      .returning();

    if (!project) {
      throw new Error("Failed to create project");
    }

    await tx.insert(projectMembers).values({
      projectId: project.id,
      userId: input.ownerUserId,
      role: "owner"
    });

    return project;
  });
}

type ScaffoldFile = {
  path: string;
  content: string;
};

function buildMinimalBlueprintScaffold(projectName: string): ScaffoldFile[] {
  const normalizedName = projectName.trim() || "TON Audit Project";

  return [
    {
      path: "README.md",
      content: `# ${normalizedName}

This project was initialized with the TON Audit Platform scaffold.

## Structure

- \`contracts/main.tolk\`: Starter contract source.
- \`tests/main.spec.ts\`: Starter test placeholder.
`
    },
    {
      path: "contracts/main.tolk",
      content: `// Minimal Tolk scaffold file

fun add(a: Int, b: Int): Int {
  return a + b;
}
`
    },
    {
      path: "tests/main.spec.ts",
      content: `// Replace with Blueprint test cases.

describe("main contract", () => {
  it("bootstraps the project", () => {
    expect(true).toBe(true);
  });
});
`
    }
  ];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorName(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function getErrorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const metadata = (error as { $metadata?: unknown }).$metadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const statusCode = (metadata as { httpStatusCode?: unknown }).httpStatusCode;
  return typeof statusCode === "number" ? statusCode : null;
}

function isRetryableStorageError(error: unknown): boolean {
  const statusCode = getErrorStatusCode(error);
  if (statusCode !== null && [408, 425, 429, 500, 502, 503, 504].includes(statusCode)) {
    return true;
  }

  const name = getErrorName(error);
  if (!name) {
    return false;
  }

  return [
    "TimeoutError",
    "NetworkingError",
    "RequestTimeout",
    "ServiceUnavailable",
    "InternalError",
    "SlowDown"
  ].includes(name);
}

function isPgUniqueViolation(error: unknown, constraint?: string): boolean {
  const code = getErrorCode(error);
  if (code !== "23505") {
    return false;
  }

  if (!constraint) {
    return true;
  }

  if (!error || typeof error !== "object") {
    return false;
  }

  const violatedConstraint = (error as { constraint?: unknown }).constraint;
  return violatedConstraint === constraint;
}

const ACTIVE_WORKING_COPY_UNIQUE_CONSTRAINT = "working_copies_active_owner_base_unique";
const ACTIVE_AUDIT_RUN_UNIQUE_CONSTRAINT = "audit_runs_project_active_unique";

export class ActiveAuditRunConflictError extends Error {
  constructor(readonly activeAuditRunId: string | null) {
    super("An audit is already running for this project.");
    this.name = "ActiveAuditRunConflictError";
  }
}

async function putObjectWithRetry(
  params: Parameters<typeof putObject>[0],
  maxAttempts = 3
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await putObject(params);
      return;
    } catch (error) {
      lastError = error;

      if (!isRetryableStorageError(error) || attempt === maxAttempts) {
        throw error;
      }

      await sleep(attempt * 200);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to upload file blob");
}

async function storeFileBlob(params: { revisionId: string; content: string }) {
  const sha = createContentFingerprint(params.content);

  const existing = await db.query.fileBlobs.findFirst({
    where: eq(fileBlobs.sha256, sha)
  });
  if (existing) {
    return existing;
  }

  const s3Key = `revisions/${params.revisionId}/files/${randomUUID()}`;
  await putObjectWithRetry({
    key: s3Key,
    body: params.content,
    contentType: "text/plain; charset=utf-8"
  });

  try {
    const [createdBlob] = await db
      .insert(fileBlobs)
      .values({
        sha256: sha,
        sizeBytes: Buffer.byteLength(params.content, "utf8"),
        s3Key,
        contentType: "text/plain; charset=utf-8"
      })
      .returning();

    if (!createdBlob) {
      throw new Error("Failed to persist file blob");
    }

    return createdBlob;
  } catch (error) {
    if (isPgUniqueViolation(error, "file_blobs_sha_unique")) {
      const concurrentBlob = await db.query.fileBlobs.findFirst({
        where: eq(fileBlobs.sha256, sha)
      });

      if (concurrentBlob) {
        return concurrentBlob;
      }
    }

    throw error;
  }
}

export async function createScaffoldRevision(params: {
  projectId: string;
  createdByUserId: string;
  projectName: string;
}) {
  const [latestRevision] = await db
    .select()
    .from(revisions)
    .where(eq(revisions.projectId, params.projectId))
    .orderBy(desc(revisions.createdAt))
    .limit(1);

  const [revision] = await db
    .insert(revisions)
    .values({
      projectId: params.projectId,
      parentRevisionId: latestRevision?.id ?? null,
      source: "upload",
      createdByUserId: params.createdByUserId,
      isImmutable: true,
      description: "Initial scaffold revision"
    })
    .returning();

  if (!revision) {
    throw new Error("Failed to create scaffold revision");
  }

  const scaffoldFiles = buildMinimalBlueprintScaffold(params.projectName);
  const blobs = await Promise.all(
    scaffoldFiles.map((file) =>
      storeFileBlob({
        revisionId: revision.id,
        content: file.content
      })
    )
  );

  await db.insert(revisionFiles).values(
    scaffoldFiles.map((file, index) => ({
      revisionId: revision.id,
      path: normalizePath(file.path),
      language: detectLanguageFromPath(file.path),
      blobId: blobs[index]!.id,
      isTestFile: /(^|\/)(test|tests|__tests__)\/|\.spec\./i.test(file.path)
    }))
  );

  return revision;
}

export async function softDeleteProject(params: { projectId: string }) {
  const [project] = await db
    .update(projects)
    .set({
      lifecycleState: "deleted",
      deletedAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(projects.id, params.projectId))
    .returning();

  return project ?? null;
}

export async function createRevisionFromUpload(params: {
  projectId: string;
  uploadId: string;
  createdByUserId: string;
}) {
  const uploadRecord = await db.query.uploads.findFirst({
    where: and(eq(uploads.id, params.uploadId), eq(uploads.projectId, params.projectId))
  });

  if (!uploadRecord) {
    throw new Error("Upload not found");
  }
  if (uploadRecord.status !== "uploaded") {
    throw new Error("Upload is not finalized");
  }

  const [latestRevision] = await db
    .select()
    .from(revisions)
    .where(eq(revisions.projectId, params.projectId))
    .orderBy(desc(revisions.createdAt))
    .limit(1);

  const [revision] = await db
    .insert(revisions)
    .values({
      projectId: params.projectId,
      parentRevisionId: latestRevision?.id ?? null,
      source: "upload",
      createdByUserId: params.createdByUserId,
      isImmutable: true,
      description: `Revision from upload ${params.uploadId}`
    })
    .returning();

  if (!revision) {
    throw new Error("Failed to create revision");
  }

  return { revision, uploadRecord };
}

export async function createWorkingCopy(params: {
  projectId: string;
  revisionId: string;
  ownerUserId: string;
}) {
  const existingWorkingCopy = await db.query.workingCopies.findFirst({
    where: and(
      eq(workingCopies.projectId, params.projectId),
      eq(workingCopies.baseRevisionId, params.revisionId),
      eq(workingCopies.ownerUserId, params.ownerUserId),
      eq(workingCopies.status, "active")
    ),
    orderBy: desc(workingCopies.createdAt)
  });

  if (existingWorkingCopy) {
    return existingWorkingCopy;
  }

  const revisionRows = await db
    .select({
      path: revisionFiles.path,
      language: revisionFiles.language,
      isTestFile: revisionFiles.isTestFile,
      s3Key: fileBlobs.s3Key,
      contentType: fileBlobs.contentType
    })
    .from(revisionFiles)
    .innerJoin(fileBlobs, eq(revisionFiles.blobId, fileBlobs.id))
    .where(eq(revisionFiles.revisionId, params.revisionId));

  const workingFiles = await Promise.all(
    revisionRows.map(async (row) => ({
      path: row.path,
      language: row.language,
      content: (await getObjectText(row.s3Key)) ?? "",
      isTestFile: row.isTestFile
    }))
  );

  try {
    return await db.transaction(async (tx) => {
      const [workingCopy] = await tx
        .insert(workingCopies)
        .values({
          projectId: params.projectId,
          baseRevisionId: params.revisionId,
          ownerUserId: params.ownerUserId,
          status: "active"
        })
        .returning();

      if (!workingCopy) {
        throw new Error("Unable to create working copy");
      }

      if (workingFiles.length) {
        await tx.insert(workingCopyFiles).values(
          workingFiles.map((file) => ({
            workingCopyId: workingCopy.id,
            path: file.path,
            language: file.language,
            content: file.content,
            isTestFile: file.isTestFile
          }))
        );
      }

      return workingCopy;
    });
  } catch (error) {
    if (isPgUniqueViolation(error, ACTIVE_WORKING_COPY_UNIQUE_CONSTRAINT)) {
      const concurrentWorkingCopy = await db.query.workingCopies.findFirst({
        where: and(
          eq(workingCopies.projectId, params.projectId),
          eq(workingCopies.baseRevisionId, params.revisionId),
          eq(workingCopies.ownerUserId, params.ownerUserId),
          eq(workingCopies.status, "active")
        ),
        orderBy: desc(workingCopies.createdAt)
      });

      if (concurrentWorkingCopy) {
        return concurrentWorkingCopy;
      }
    }

    throw error;
  }
}

export async function saveWorkingCopyFile(params: {
  workingCopyId: string;
  path: string;
  content: string;
  language?: Language;
  isTestFile?: boolean;
}) {
  const normalizedPath = normalizePath(params.path);
  const language = params.language ?? detectLanguageFromPath(normalizedPath);

  const [upserted] = await db
    .insert(workingCopyFiles)
    .values({
      workingCopyId: params.workingCopyId,
      path: normalizedPath,
      language,
      content: params.content,
      isTestFile: params.isTestFile ?? false
    })
    .onConflictDoUpdate({
      target: [workingCopyFiles.workingCopyId, workingCopyFiles.path],
      set: {
        content: params.content,
        language,
        ...(params.isTestFile === undefined ? {} : { isTestFile: params.isTestFile }),
        updatedAt: new Date()
      }
    })
    .returning();

  return upserted;
}

export async function snapshotWorkingCopyAndCreateAuditRun(params: {
  projectId: string;
  workingCopyId: string;
  userId: string;
  primaryModelId: string;
  fallbackModelId: string;
  profile: AuditProfile;
}) {
  const workingCopy = await db.query.workingCopies.findFirst({
    where: and(
      eq(workingCopies.id, params.workingCopyId),
      eq(workingCopies.projectId, params.projectId),
      eq(workingCopies.ownerUserId, params.userId)
    )
  });

  if (!workingCopy) {
    throw new Error("Working copy not found");
  }

  const preexistingAuditRun = await findActiveAuditRun(params.projectId);
  if (preexistingAuditRun) {
    throw new ActiveAuditRunConflictError(preexistingAuditRun.id);
  }

  const files = await db.query.workingCopyFiles.findMany({
    where: eq(workingCopyFiles.workingCopyId, params.workingCopyId)
  });

  const snapshotRevisionId = randomUUID();
  const insertedBlobs = await Promise.all(
    files.map((file) =>
      storeFileBlob({
        revisionId: snapshotRevisionId,
        content: file.content
      })
    )
  );

  try {
    return await db.transaction(async (tx) => {
      const [revision] = await tx
        .insert(revisions)
        .values({
          id: snapshotRevisionId,
          projectId: params.projectId,
          parentRevisionId: workingCopy.baseRevisionId,
          source: "working-copy",
          createdByUserId: params.userId,
          isImmutable: true,
          description: `Snapshot from working copy ${workingCopy.id}`
        })
        .returning();

      if (!revision) {
        throw new Error("Failed to create snapshot revision");
      }

      if (files.length) {
        await tx.insert(revisionFiles).values(
          files.map((file, index) => ({
            revisionId: revision.id,
            path: file.path,
            language: file.language,
            blobId: insertedBlobs[index]?.id ?? insertedBlobs[0]!.id,
            isTestFile: file.isTestFile
          }))
        );
      }

      const [auditRun] = await tx
        .insert(auditRuns)
        .values({
          projectId: params.projectId,
          revisionId: revision.id,
          status: "queued",
          requestedByUserId: params.userId,
          profile: params.profile,
          primaryModelId: params.primaryModelId,
          fallbackModelId: params.fallbackModelId,
          engineVersion: "ton-audit-pro-v2",
          reportSchemaVersion: 2
        })
        .returning();

      if (!auditRun) {
        throw new Error("Failed to create audit run");
      }

      return { revision, auditRun };
    });
  } catch (error) {
    if (isPgUniqueViolation(error, ACTIVE_AUDIT_RUN_UNIQUE_CONSTRAINT)) {
      const activeAuditRun = await findActiveAuditRun(params.projectId);
      throw new ActiveAuditRunConflictError(activeAuditRun?.id ?? null);
    }

    throw error;
  }
}

export async function getAuditDiff(projectId: string, auditRunId: string) {
  const auditRun = await db.query.auditRuns.findFirst({
    where: and(eq(auditRuns.id, auditRunId), eq(auditRuns.projectId, projectId))
  });

  if (!auditRun) {
    return null;
  }

  const revision = await db.query.revisions.findFirst({
    where: eq(revisions.id, auditRun.revisionId)
  });

  if (!revision) {
    return null;
  }

  const prevAudit = await db
    .select()
    .from(auditRuns)
    .where(
      and(
        eq(auditRuns.projectId, projectId),
        eq(auditRuns.status, "completed"),
        sql`${auditRuns.createdAt} < ${auditRun.createdAt}`
      )
    )
    .orderBy(desc(auditRuns.createdAt))
    .limit(1);

  const currentFiles = await db
    .select({ path: revisionFiles.path })
    .from(revisionFiles)
    .where(eq(revisionFiles.revisionId, revision.id));

  const previousFiles = prevAudit[0]
    ? await db
        .select({ path: revisionFiles.path })
        .from(revisionFiles)
        .where(eq(revisionFiles.revisionId, prevAudit[0].revisionId))
    : [];

  const currentSet = new Set(currentFiles.map((file) => file.path));
  const previousSet = new Set(previousFiles.map((file) => file.path));

  const added = [...currentSet].filter((path) => !previousSet.has(path));
  const removed = [...previousSet].filter((path) => !currentSet.has(path));
  const unchanged = [...currentSet].filter((path) => previousSet.has(path));

  const transitions = await db.query.findingTransitions.findMany({
    where: eq(findingTransitions.toAuditRunId, auditRunId)
  });

  return {
    auditRun,
    files: {
      added,
      removed,
      unchanged
    },
    transitions
  };
}

export async function findAuditRunWithProject(projectId: string, auditRunId: string) {
  return db.query.auditRuns.findFirst({
    where: and(eq(auditRuns.id, auditRunId), eq(auditRuns.projectId, projectId))
  });
}

export async function findActiveAuditRun(projectId: string) {
  return db.query.auditRuns.findFirst({
    where: and(eq(auditRuns.projectId, projectId), inArray(auditRuns.status, ["queued", "running"])),
    orderBy: desc(auditRuns.createdAt)
  });
}

export async function getLatestProjectState(projectId: string, userId?: string) {
  const [latestRevision] = await db
    .select()
    .from(revisions)
    .where(eq(revisions.projectId, projectId))
    .orderBy(desc(revisions.createdAt))
    .limit(1);

  const [latestAudit] = await db
    .select()
    .from(auditRuns)
    .where(eq(auditRuns.projectId, projectId))
    .orderBy(desc(auditRuns.createdAt))
    .limit(1);

  let activeWorkingCopy: typeof workingCopies.$inferSelect | null = null;
  if (latestRevision && userId) {
    [activeWorkingCopy] = await db
      .select()
      .from(workingCopies)
      .where(
        and(
          eq(workingCopies.projectId, projectId),
          eq(workingCopies.ownerUserId, userId),
          eq(workingCopies.baseRevisionId, latestRevision.id),
          eq(workingCopies.status, "active")
        )
      )
      .orderBy(desc(workingCopies.createdAt))
      .limit(1);
  }

  return {
    latestRevision,
    latestAudit,
    activeWorkingCopy
  };
}

type AuditHistoryPdfStatus = PdfExportStatus | "not_requested";
type AuditHistoryPdfStatusByVariant = Record<PdfExportVariant, AuditHistoryPdfStatus>;

function resolveFinalPdfStatus(statusByVariant: AuditHistoryPdfStatusByVariant): AuditHistoryPdfStatus {
  if (statusByVariant[FINAL_PDF_VARIANT] !== "not_requested") {
    return statusByVariant[FINAL_PDF_VARIANT];
  }

  return statusByVariant.client;
}

type AuditHistoryItem = {
  id: string;
  revisionId: string;
  revisionSource: RevisionSource;
  revisionDescription: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  profile: AuditProfile;
  engineVersion: string;
  reportSchemaVersion: number;
  primaryModelId: string;
  fallbackModelId: string;
  findingCount: number;
  pdfStatus: AuditHistoryPdfStatus;
  pdfStatusByVariant: AuditHistoryPdfStatusByVariant;
};

type ComparisonFindingSummary = {
  findingId: string;
  title: string;
  severity: string;
  filePath: string;
  startLine: number;
};

type AuditCompareResponse = {
  fromAudit: {
    id: string;
    revisionId: string;
    createdAt: string;
    findingCount: number;
  };
  toAudit: {
    id: string;
    revisionId: string;
    createdAt: string;
    findingCount: number;
  };
  summary: {
    findings: {
      fromTotal: number;
      toTotal: number;
      newCount: number;
      resolvedCount: number;
      persistingCount: number;
      severityChangedCount: number;
    };
    files: {
      addedCount: number;
      removedCount: number;
      unchangedCount: number;
    };
  };
  findings: {
    newlyDetected: ComparisonFindingSummary[];
    resolved: ComparisonFindingSummary[];
    persisting: Array<
      Omit<ComparisonFindingSummary, "severity"> & {
        fromSeverity: string;
        toSeverity: string;
      }
    >;
  };
  files: {
    added: string[];
    removed: string[];
    unchanged: string[];
  };
};

type AuditCompareResult =
  | {
      kind: "not-found";
    }
  | {
      kind: "not-completed";
      fromStatus: string;
      toStatus: string;
    }
  | {
      kind: "ok";
      comparison: AuditCompareResponse;
    };

function toIsoString(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function readFindingSummary(params: {
  findingId: string;
  severity: string;
  payloadJson: Record<string, unknown>;
}): ComparisonFindingSummary {
  const payload = params.payloadJson;
  const evidence =
    payload.evidence && typeof payload.evidence === "object"
      ? (payload.evidence as Record<string, unknown>)
      : null;
  const startLineRaw = evidence?.startLine;
  const startLine =
    typeof startLineRaw === "number" && Number.isFinite(startLineRaw)
      ? Math.max(0, Math.trunc(startLineRaw))
      : 0;

  return {
    findingId: params.findingId,
    title: typeof payload.title === "string" ? payload.title : "Untitled finding",
    severity: typeof payload.severity === "string" ? payload.severity : params.severity,
    filePath:
      typeof evidence?.filePath === "string" && evidence.filePath.trim().length
        ? evidence.filePath
        : "unknown",
    startLine
  };
}

export async function queryProjectAuditHistory(projectId: string): Promise<AuditHistoryItem[]> {
  const audits = await db
    .select()
    .from(auditRuns)
    .where(eq(auditRuns.projectId, projectId))
    .orderBy(desc(auditRuns.createdAt));

  if (!audits.length) {
    return [];
  }

  const auditIds = audits.map((audit) => audit.id);
  const revisionIds = [...new Set(audits.map((audit) => audit.revisionId))];

  const [revisionRows, findingCountRows, pdfRows] = await Promise.all([
    db
      .select({
        id: revisions.id,
        source: revisions.source,
        description: revisions.description
      })
      .from(revisions)
      .where(inArray(revisions.id, revisionIds)),
    db
      .select({
        auditRunId: findingInstances.auditRunId,
        count: sql<number>`cast(count(*) as int)`
      })
      .from(findingInstances)
      .where(inArray(findingInstances.auditRunId, auditIds))
      .groupBy(findingInstances.auditRunId),
    db
      .select({
        auditRunId: pdfExports.auditRunId,
        variant: pdfExports.variant,
        status: pdfExports.status
      })
      .from(pdfExports)
      .where(inArray(pdfExports.auditRunId, auditIds))
  ]);

  const revisionById = new Map(
    revisionRows.map((row) => [row.id, { source: row.source, description: row.description }])
  );
  const findingCountByAuditId = new Map(
    findingCountRows.map((row) => [row.auditRunId, Number(row.count) || 0])
  );
  const emptyPdfStatus = (): AuditHistoryPdfStatusByVariant => ({
    client: "not_requested",
    internal: "not_requested"
  });
  const pdfStatusByAuditId = new Map<string, AuditHistoryPdfStatusByVariant>();
  for (const row of pdfRows) {
    const current = pdfStatusByAuditId.get(row.auditRunId) ?? emptyPdfStatus();
    current[row.variant] = row.status;
    pdfStatusByAuditId.set(row.auditRunId, current);
  }

  return audits.map((audit) => {
    const revisionMeta = revisionById.get(audit.revisionId);
    const statusByVariant = pdfStatusByAuditId.get(audit.id) ?? emptyPdfStatus();

    return {
      id: audit.id,
      revisionId: audit.revisionId,
      revisionSource: revisionMeta?.source ?? "working-copy",
      revisionDescription: revisionMeta?.description ?? null,
      status: audit.status,
      createdAt: toIsoString(audit.createdAt) ?? new Date(0).toISOString(),
      startedAt: toIsoString(audit.startedAt),
      finishedAt: toIsoString(audit.finishedAt),
      profile: audit.profile,
      engineVersion: audit.engineVersion,
      reportSchemaVersion: audit.reportSchemaVersion,
      primaryModelId: audit.primaryModelId,
      fallbackModelId: audit.fallbackModelId,
      findingCount: findingCountByAuditId.get(audit.id) ?? 0,
      pdfStatus: resolveFinalPdfStatus(statusByVariant),
      pdfStatusByVariant: statusByVariant
    };
  });
}

export async function getAuditComparison(params: {
  projectId: string;
  fromAuditId: string;
  toAuditId: string;
}): Promise<AuditCompareResult> {
  const uniqueAuditIds = [...new Set([params.fromAuditId, params.toAuditId])];
  if (uniqueAuditIds.length !== 2) {
    return { kind: "not-found" };
  }

  const selectedAudits = await db
    .select()
    .from(auditRuns)
    .where(and(eq(auditRuns.projectId, params.projectId), inArray(auditRuns.id, uniqueAuditIds)));

  const explicitFromAudit = selectedAudits.find((audit) => audit.id === params.fromAuditId);
  const explicitToAudit = selectedAudits.find((audit) => audit.id === params.toAuditId);
  if (!explicitFromAudit || !explicitToAudit) {
    return { kind: "not-found" };
  }

  if (explicitFromAudit.status !== "completed" || explicitToAudit.status !== "completed") {
    return {
      kind: "not-completed",
      fromStatus: explicitFromAudit.status,
      toStatus: explicitToAudit.status
    };
  }

  const [olderAudit, newerAudit] = [explicitFromAudit, explicitToAudit].sort((left, right) => {
    const delta = left.createdAt.getTime() - right.createdAt.getTime();
    if (delta !== 0) {
      return delta;
    }

    return left.id.localeCompare(right.id);
  });

  const [findingRows, olderFileRows, newerFileRows] = await Promise.all([
    db
      .select({
        auditRunId: findingInstances.auditRunId,
        findingId: findingInstances.findingId,
        severity: findingInstances.severity,
        payloadJson: findingInstances.payloadJson
      })
      .from(findingInstances)
      .where(inArray(findingInstances.auditRunId, [olderAudit.id, newerAudit.id])),
    db
      .select({
        path: revisionFiles.path
      })
      .from(revisionFiles)
      .where(eq(revisionFiles.revisionId, olderAudit.revisionId)),
    db
      .select({
        path: revisionFiles.path
      })
      .from(revisionFiles)
      .where(eq(revisionFiles.revisionId, newerAudit.revisionId))
  ]);

  const olderFindingsById = new Map<string, ComparisonFindingSummary>();
  const newerFindingsById = new Map<string, ComparisonFindingSummary>();

  for (const row of findingRows) {
    const summary = readFindingSummary({
      findingId: row.findingId,
      severity: row.severity,
      payloadJson: row.payloadJson ?? {}
    });

    if (row.auditRunId === olderAudit.id) {
      olderFindingsById.set(row.findingId, summary);
    } else if (row.auditRunId === newerAudit.id) {
      newerFindingsById.set(row.findingId, summary);
    }
  }

  const newlyDetected = [...newerFindingsById.entries()]
    .filter(([findingId]) => !olderFindingsById.has(findingId))
    .map(([, summary]) => summary)
    .sort((left, right) => left.title.localeCompare(right.title));
  const resolved = [...olderFindingsById.entries()]
    .filter(([findingId]) => !newerFindingsById.has(findingId))
    .map(([, summary]) => summary)
    .sort((left, right) => left.title.localeCompare(right.title));

  const persisting = [...newerFindingsById.entries()]
    .filter(([findingId]) => olderFindingsById.has(findingId))
    .map(([findingId, toSummary]) => {
      const fromSummary = olderFindingsById.get(findingId)!;
      return {
        findingId,
        title: toSummary.title,
        fromSeverity: fromSummary.severity,
        toSeverity: toSummary.severity,
        filePath: toSummary.filePath,
        startLine: toSummary.startLine
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));

  const severityChangedCount = persisting.filter(
    (entry) => entry.fromSeverity !== entry.toSeverity
  ).length;

  const olderFileSet = new Set(olderFileRows.map((row) => row.path));
  const newerFileSet = new Set(newerFileRows.map((row) => row.path));
  const added = [...newerFileSet].filter((path) => !olderFileSet.has(path)).sort((a, b) => a.localeCompare(b));
  const removed = [...olderFileSet].filter((path) => !newerFileSet.has(path)).sort((a, b) => a.localeCompare(b));
  const unchanged = [...newerFileSet].filter((path) => olderFileSet.has(path)).sort((a, b) => a.localeCompare(b));

  return {
    kind: "ok",
    comparison: {
      fromAudit: {
        id: olderAudit.id,
        revisionId: olderAudit.revisionId,
        createdAt: toIsoString(olderAudit.createdAt) ?? new Date(0).toISOString(),
        findingCount: olderFindingsById.size
      },
      toAudit: {
        id: newerAudit.id,
        revisionId: newerAudit.revisionId,
        createdAt: toIsoString(newerAudit.createdAt) ?? new Date(0).toISOString(),
        findingCount: newerFindingsById.size
      },
      summary: {
        findings: {
          fromTotal: olderFindingsById.size,
          toTotal: newerFindingsById.size,
          newCount: newlyDetected.length,
          resolvedCount: resolved.length,
          persistingCount: persisting.length,
          severityChangedCount
        },
        files: {
          addedCount: added.length,
          removedCount: removed.length,
          unchangedCount: unchanged.length
        }
      },
      findings: {
        newlyDetected,
        resolved,
        persisting
      },
      files: {
        added,
        removed,
        unchanged
      }
    }
  };
}

export async function createPdfExport(auditRunId: string, variant: PdfExportVariant = FINAL_PDF_VARIANT) {
  const [record] = await db
    .insert(pdfExports)
    .values({
      auditRunId,
      variant,
      status: "queued"
    })
    .onConflictDoUpdate({
      target: [pdfExports.auditRunId, pdfExports.variant],
      set: {
        status: "queued",
        s3Key: null,
        generatedAt: null,
        expiresAt: null,
        updatedAt: new Date()
      }
    })
    .returning();

  return record;
}

export async function getPdfExportByAudit(
  auditRunId: string,
  variant: PdfExportVariant = FINAL_PDF_VARIANT
) {
  const requestedVariant = await db.query.pdfExports.findFirst({
    where: and(eq(pdfExports.auditRunId, auditRunId), eq(pdfExports.variant, variant))
  });

  if (requestedVariant || variant === "client") {
    return requestedVariant;
  }

  return db.query.pdfExports.findFirst({
    where: and(eq(pdfExports.auditRunId, auditRunId), eq(pdfExports.variant, "client"))
  });
}
