import { NextResponse } from "next/server";

import { requireSession, toApiErrorResponse } from "@/lib/server/api";
import { ensureProjectAccess, getAuditComparison } from "@/lib/server/domain";

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

    const search = new URL(request.url).searchParams;
    const fromAuditId = search.get("fromAuditId")?.trim() ?? "";
    const toAuditId = search.get("toAuditId")?.trim() ?? "";

    if (!fromAuditId || !toAuditId) {
      return NextResponse.json(
        { error: "Both fromAuditId and toAuditId query parameters are required." },
        { status: 400 }
      );
    }

    if (fromAuditId === toAuditId) {
      return NextResponse.json(
        { error: "fromAuditId and toAuditId must be different audit runs." },
        { status: 400 }
      );
    }

    const result = await getAuditComparison({
      projectId,
      fromAuditId,
      toAuditId
    });

    if (result.kind === "not-found") {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }

    if (result.kind === "not-completed") {
      return NextResponse.json(
        {
          error: `Both audits must be completed before comparison (from=${result.fromStatus}, to=${result.toStatus}).`
        },
        { status: 409 }
      );
    }

    return NextResponse.json(result.comparison);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
