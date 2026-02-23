import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { revisions } from "@ton-audit/shared";

import { requireSession, toApiErrorResponse } from "@/lib/server/api";
import { createWorkingCopy, ensureProjectAccess } from "@/lib/server/domain";
import { db } from "@/lib/server/db";

export async function POST(
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

    const workingCopy = await createWorkingCopy({
      projectId,
      revisionId,
      ownerUserId: session.user.id
    });

    return NextResponse.json({ workingCopy }, { status: 201 });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
