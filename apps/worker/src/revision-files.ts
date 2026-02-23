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
