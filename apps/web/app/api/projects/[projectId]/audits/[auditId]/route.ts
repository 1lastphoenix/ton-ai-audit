import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { findingInstances, normalizeAuditReport } from "@ton-audit/shared";

import { requireSession, toApiErrorResponse } from "@/lib/server/api";
import { ensureProjectAccess, findAuditRunWithProject } from "@/lib/server/domain";
import { db } from "@/lib/server/db";

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

    const audit = await findAuditRunWithProject(projectId, auditId);
    if (!audit) {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }

    const findings = await db
      .select()
      .from(findingInstances)
      .where(eq(findingInstances.auditRunId, auditId));

    const normalizedReport = audit.reportJson ? normalizeAuditReport(audit.reportJson) : null;

    return NextResponse.json({
      audit,
      findings,
      report: normalizedReport
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
