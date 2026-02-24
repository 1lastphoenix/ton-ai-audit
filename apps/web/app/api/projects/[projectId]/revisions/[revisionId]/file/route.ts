import { NextResponse } from "next/server";

import { and, eq } from "drizzle-orm";

import { fileBlobs, normalizePath, revisionFiles, revisions } from "@ton-audit/shared";

import { requireSession, toApiErrorResponse } from "@/lib/server/api";
import { ensureProjectAccess } from "@/lib/server/domain";
import { db } from "@/lib/server/db";
import { getObjectText } from "@/lib/server/s3";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; revisionId: string }> }
) {
  try {
    const session = await requireSession(request);
    const { projectId, revisionId } = await context.params;

    const project = await ensureProjectAccess(projectId, session.user.id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const search = new URL(request.url).searchParams;
    const path = normalizePath(search.get("path") ?? "");

    if (!path) {
      return NextResponse.json({ error: "Missing file path" }, { status: 400 });
    }

    const revision = await db.query.revisions.findFirst({
      where: eq(revisions.id, revisionId)
    });

    if (!revision || revision.projectId !== projectId) {
      return NextResponse.json({ error: "Revision not found" }, { status: 404 });
    }

    const [row] = await db
      .select({
        path: revisionFiles.path,
        language: revisionFiles.language,
        s3Key: fileBlobs.s3Key
      })
      .from(revisionFiles)
      .innerJoin(fileBlobs, eq(revisionFiles.blobId, fileBlobs.id))
      .where(and(eq(revisionFiles.revisionId, revisionId), eq(revisionFiles.path, path)))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const content = await getObjectText(row.s3Key);
    if (content === null) {
      return NextResponse.json({ error: "File content not found" }, { status: 404 });
    }

    return NextResponse.json({
      file: {
        path: row.path,
        language: row.language,
        content
      }
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
