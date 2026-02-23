import { NextResponse } from "next/server";

import { requireSession, toApiErrorResponse } from "@/lib/server/api";
import { ensureProjectAccess, getAuditDiff } from "@/lib/server/domain";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; auditId: string }> }
) {
  try {
    const session = await requireSession(request);
    const { projectId, auditId } = await context.params;

    const project = await ensureProjectAccess(projectId, session.user.id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const diff = await getAuditDiff(projectId, auditId);

    if (!diff) {
      return NextResponse.json({ error: "Diff unavailable" }, { status: 404 });
    }

    return NextResponse.json(diff);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}