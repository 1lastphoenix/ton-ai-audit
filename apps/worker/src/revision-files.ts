import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import {
  createContentFingerprint,
  fileBlobs,
  revisionFiles,
  type Language
} from "@ton-audit/shared";

import { db } from "./db";
import { getObjectText, putObject } from "./s3";

export type RevisionFileContent = {
  path: string;
  language: Language;
  isTestFile: boolean;
  content: string;
};

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function isPgUniqueViolation(error: unknown, constraint?: string): boolean {
  if (getErrorCode(error) !== "23505") {
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

export async function loadRevisionFilesWithContent(
  revisionId: string
): Promise<RevisionFileContent[]> {
  const rows = await db
    .select({
      path: revisionFiles.path,
      language: revisionFiles.language,
      isTestFile: revisionFiles.isTestFile,
      s3Key: fileBlobs.s3Key
    })
    .from(revisionFiles)
    .innerJoin(fileBlobs, eq(revisionFiles.blobId, fileBlobs.id))
    .where(eq(revisionFiles.revisionId, revisionId));

  return Promise.all(
    rows.map(async (row) => {
      const content = (await getObjectText(row.s3Key)) ?? "";

      return {
        path: row.path,
        language: row.language,
        isTestFile: row.isTestFile,
        content
      };
    })
  );
}

async function ensureBlobFromContent(content: string) {
  const sha = createContentFingerprint(content);
  const existing = await db.query.fileBlobs.findFirst({
    where: eq(fileBlobs.sha256, sha)
  });

  if (existing) {
    return existing;
  }

  const key = `blobs/${sha}-${randomUUID()}.txt`;

  await putObject({
    key,
    body: content,
    contentType: "text/plain; charset=utf-8"
  });

  try {
    const [created] = await db
      .insert(fileBlobs)
      .values({
        sha256: sha,
        sizeBytes: Buffer.byteLength(content, "utf8"),
        s3Key: key,
        contentType: "text/plain; charset=utf-8"
      })
      .returning();

    if (!created) {
      throw new Error("Failed to persist blob");
    }

    return created;
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

export async function upsertRevisionFile(params: {
  revisionId: string;
  path: string;
  language: Language;
  isTestFile: boolean;
  content: string;
}) {
  const blob = await ensureBlobFromContent(params.content);

  await db
    .insert(revisionFiles)
    .values({
      revisionId: params.revisionId,
      path: params.path,
      language: params.language,
      blobId: blob.id,
      isTestFile: params.isTestFile
    })
    .onConflictDoUpdate({
      target: [revisionFiles.revisionId, revisionFiles.path],
      set: {
        language: params.language,
        blobId: blob.id,
        isTestFile: params.isTestFile
      }
    });
}

export async function clearRevisionFiles(revisionId: string) {
  await db.delete(revisionFiles).where(eq(revisionFiles.revisionId, revisionId));
}
