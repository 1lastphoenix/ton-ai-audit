import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { revisionFiles, revisions } from "@ton-audit/shared";

import { requireSession, toApiErrorResponse } from "@/lib/server/api";
import { ensureProjectAccess } from "@/lib/server/domain";
import { db } from "@/lib/server/db";
import { buildFileTree } from "@/lib/server/file-tree";

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

    const revision = await db.query.revisions.findFirst({
      where: eq(revisions.id, revisionId)
    });

    if (!revision || revision.projectId !== projectId) {
      return NextResponse.json({ error: "Revision not found" }, { status: 404 });
    }

    const files = await db
      .select({ path: revisionFiles.path })
      .from(revisionFiles)
      .where(eq(revisionFiles.revisionId, revisionId));

    return NextResponse.json({
      tree: buildFileTree(files.map((file) => file.path))
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
