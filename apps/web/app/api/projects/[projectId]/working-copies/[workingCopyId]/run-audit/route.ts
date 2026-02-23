import { NextResponse } from "next/server";

import { runAuditSchema } from "@ton-audit/shared";

import { parseJsonBody, requireSession, toApiErrorResponse } from "@/lib/server/api";
import { ensureProjectAccess, snapshotWorkingCopyAndCreateAuditRun } from "@/lib/server/domain";
import { assertAllowedModel, getAuditModelAllowlist } from "@/lib/server/model-allowlist";
import { enqueueJob } from "@/lib/server/queues";

export async function POST(
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

    const body = await parseJsonBody(request, runAuditSchema);
    const modelAllowlist = await getAuditModelAllowlist();
    assertAllowedModel(body.primaryModelId, modelAllowlist);
    assertAllowedModel(body.fallbackModelId, modelAllowlist);

    const { revision, auditRun } = await snapshotWorkingCopyAndCreateAuditRun({
      projectId,
      workingCopyId,
      userId: session.user.id,
      primaryModelId: body.primaryModelId,
      fallbackModelId: body.fallbackModelId
    });

    const verifyJob = await enqueueJob(
      "verify",
      {
        projectId,
        revisionId: revision.id,
        auditRunId: auditRun.id,
        includeDocsFallbackFetch: body.includeDocsFallbackFetch
      },
      `verify:${projectId}:${auditRun.id}`
    );

    return NextResponse.json({
      revision,
      auditRun,
      verifyJobId: verifyJob.id
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
