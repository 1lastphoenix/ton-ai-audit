import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { workingCopyFiles } from "@ton-audit/shared";

import { requireSession, toApiErrorResponse } from "@/lib/server/api";
import { ensureProjectAccess, ensureWorkingCopyAccess } from "@/lib/server/domain";
import { db } from "@/lib/server/db";
import { buildFileTree } from "@/lib/server/file-tree";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; workingCopyId: string }> }
) {
  try {
    const session = await requireSession(request);
    const { projectId, workingCopyId } = await context.params;

    const project = await ensureProjectAccess(projectId, session.user.id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const workingCopy = await ensureWorkingCopyAccess(workingCopyId, session.user.id, projectId);
    if (!workingCopy) {
      return NextResponse.json({ error: "Working copy not found" }, { status: 404 });
    }

    const files = await db
      .select({ path: workingCopyFiles.path })
      .from(workingCopyFiles)
      .where(eq(workingCopyFiles.workingCopyId, workingCopyId));

    return NextResponse.json({
      tree: buildFileTree(files.map((file) => file.path))
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
