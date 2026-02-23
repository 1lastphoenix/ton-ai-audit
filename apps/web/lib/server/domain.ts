import { randomUUID } from "node:crypto";

import {
  and,
  desc,
  eq,
  ne,
  sql
} from "drizzle-orm";

import {
  createContentFingerprint,
  detectLanguageFromPath,
  normalizePath,
  projectLifecycleStateSchema,
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
  findingTransitions,
  pdfExports
} from "@ton-audit/shared";

import { db } from "./db";
import { getObjectText, putObject } from "./s3";

export async function ensureProjectAccess(projectId: string, userId: string) {
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
  return db.query.projects.findFirst({
    where: and(
      eq(projects.id, projectId),
      eq(projects.ownerUserId, userId),
      ne(projects.lifecycleState, "deleted")
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

  const [project] = await db
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

  await db.insert(projectMembers).values({
    projectId: project.id,
    userId: input.ownerUserId,
    role: "owner"
  });

  return project;
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

async function storeFileBlob(params: { revisionId: string; content: string }) {
  const sha = createContentFingerprint(params.content);

  const existing = await db.query.fileBlobs.findFirst({
    where: eq(fileBlobs.sha256, sha)
  });
  if (existing) {
    return existing;
  }

  const s3Key = `revisions/${params.revisionId}/files/${randomUUID()}`;
  await putObject({
    key: s3Key,
    body: params.content,
    contentType: "text/plain; charset=utf-8"
  });

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

export async function markProjectReadyIfInitializing(projectId: string) {
  const [project] = await db
    .update(projects)
    .set({
      lifecycleState: "ready",
      deletedAt: null,
      updatedAt: new Date()
    })
    .where(and(eq(projects.id, projectId), eq(projects.lifecycleState, "initializing")))
    .returning();

  return project ?? null;
}

export async function markProjectDeletedIfInitializing(projectId: string) {
  const [project] = await db
    .update(projects)
    .set({
      lifecycleState: "deleted",
      deletedAt: new Date(),
      updatedAt: new Date()
    })
    .where(and(eq(projects.id, projectId), eq(projects.lifecycleState, "initializing")))
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
  const [workingCopy] = await db
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

  if (revisionRows.length) {
    const workingFiles = await Promise.all(
      revisionRows.map(async (row) => ({
        workingCopyId: workingCopy.id,
        path: row.path,
        language: row.language,
        content: (await getObjectText(row.s3Key)) ?? "",
        isTestFile: row.isTestFile
      }))
    );

    await db.insert(workingCopyFiles).values(workingFiles);
  }

  return workingCopy;
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

  const current = await db.query.workingCopyFiles.findFirst({
    where: and(
      eq(workingCopyFiles.workingCopyId, params.workingCopyId),
      eq(workingCopyFiles.path, normalizedPath)
    )
  });

  if (current) {
    const [updated] = await db
      .update(workingCopyFiles)
      .set({
        content: params.content,
        language,
        isTestFile: params.isTestFile ?? current.isTestFile,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(workingCopyFiles.workingCopyId, params.workingCopyId),
          eq(workingCopyFiles.path, normalizedPath)
        )
      )
      .returning();

    return updated;
  }

  const [created] = await db
    .insert(workingCopyFiles)
    .values({
      workingCopyId: params.workingCopyId,
      path: normalizedPath,
      language,
      content: params.content,
      isTestFile: params.isTestFile ?? false
    })
    .returning();

  return created;
}

export async function snapshotWorkingCopyAndCreateAuditRun(params: {
  projectId: string;
  workingCopyId: string;
  userId: string;
  primaryModelId: string;
  fallbackModelId: string;
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

  const [revision] = await db
    .insert(revisions)
    .values({
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

  const files = await db.query.workingCopyFiles.findMany({
    where: eq(workingCopyFiles.workingCopyId, params.workingCopyId)
  });

  if (files.length) {
    const insertedBlobs = await Promise.all(
      files.map(async (file) => {
        const sha = createContentFingerprint(file.content);
        const existing = await db.query.fileBlobs.findFirst({
          where: eq(fileBlobs.sha256, sha)
        });

        if (existing) {
          return existing;
        }

        const s3Key = `revisions/${revision.id}/files/${randomUUID()}`;
        await putObject({
          key: s3Key,
          body: file.content,
          contentType: "text/plain; charset=utf-8"
        });

        const [createdBlob] = await db
          .insert(fileBlobs)
          .values({
            sha256: sha,
            sizeBytes: Buffer.byteLength(file.content, "utf8"),
            s3Key,
            contentType: "text/plain; charset=utf-8"
          })
          .returning();

        if (!createdBlob) {
          throw new Error(`Failed to persist blob for ${file.path}`);
        }

        return createdBlob;
      })
    );

    await db.insert(revisionFiles).values(
      files.map((file, index) => ({
        revisionId: revision.id,
        path: file.path,
        language: file.language,
        blobId: insertedBlobs[index]?.id ?? insertedBlobs[0]!.id,
        isTestFile: file.isTestFile
      }))
    );
  }

  const [auditRun] = await db
    .insert(auditRuns)
    .values({
      projectId: params.projectId,
      revisionId: revision.id,
      status: "queued",
      requestedByUserId: params.userId,
      primaryModelId: params.primaryModelId,
      fallbackModelId: params.fallbackModelId
    })
    .returning();

  if (!auditRun) {
    throw new Error("Failed to create audit run");
  }

  return { revision, auditRun };
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

export async function getLatestProjectState(projectId: string) {
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

  return {
    latestRevision,
    latestAudit
  };
}

export async function queryProjectAudits(projectId: string) {
  return db
    .select()
    .from(auditRuns)
    .where(eq(auditRuns.projectId, projectId))
    .orderBy(desc(auditRuns.createdAt));
}

export async function createPdfExport(auditRunId: string) {
  const [record] = await db
    .insert(pdfExports)
    .values({
      auditRunId,
      status: "queued"
    })
    .onConflictDoUpdate({
      target: pdfExports.auditRunId,
      set: {
        status: "queued",
        updatedAt: new Date()
      }
    })
    .returning();

  return record;
}

export async function getPdfExportByAudit(auditRunId: string) {
  return db.query.pdfExports.findFirst({
    where: eq(pdfExports.auditRunId, auditRunId)
  });
}
