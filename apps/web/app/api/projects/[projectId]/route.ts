import { NextResponse } from "next/server";

import {
  ensureProjectAccess,
  ensureProjectOwnerAccess,
  getLatestProjectState,
  softDeleteProject
} from "@/lib/server/domain";
import { requireSession, toApiErrorResponse } from "@/lib/server/api";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await requireSession(request);
    const { projectId } = await context.params;

    const project = await ensureProjectAccess(projectId, session.user.id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const latest = await getLatestProjectState(project.id, session.user.id);

    return NextResponse.json({
      project,
      latest
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await requireSession(request);
    const { projectId } = await context.params;

    const project = await ensureProjectOwnerAccess(projectId, session.user.id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const deleted = await softDeleteProject({ projectId: project.id });
    return NextResponse.json({ project: deleted });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
