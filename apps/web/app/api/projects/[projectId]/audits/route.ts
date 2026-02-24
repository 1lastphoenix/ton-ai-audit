import { NextResponse } from "next/server";

import { requireSession, toApiErrorResponse } from "@/lib/server/api";
import { ensureProjectAccess, queryProjectAuditHistory } from "@/lib/server/domain";

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

    const audits = await queryProjectAuditHistory(projectId);
    return NextResponse.json({ audits });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
