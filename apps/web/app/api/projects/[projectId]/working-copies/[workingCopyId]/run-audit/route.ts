import { NextResponse } from "next/server";

import { runAuditSchema } from "@ton-audit/shared";

import { checkRateLimit, parseJsonBody, requireSession, toApiErrorResponse } from "@/lib/server/api";
import {
  ensureProjectAccess,
  findActiveAuditRun,
  snapshotWorkingCopyAndCreateAuditRun
} from "@/lib/server/domain";
import { assertAllowedModel, getAuditModelAllowlist } from "@/lib/server/model-allowlist";
import { enqueueJob } from "@/lib/server/queues";

const AUDIT_REQUESTABLE_PROJECT_STATES = new Set(["draft", "changes_pending", "ready"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; workingCopyId: string }> }
) {
  try {
    const session = await requireSession(request);
    const { projectId, workingCopyId } = await context.params;
    // 10 audit runs per 10 minutes per user.
    checkRateLimit(session.user.id, "run-audit", 10, 10 * 60_000);

    const project = await ensureProjectAccess(projectId, session.user.id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (!AUDIT_REQUESTABLE_PROJECT_STATES.has(project.lifecycleState)) {
      return NextResponse.json(
        {
          error: `Audit requests are not allowed while project state is '${project.lifecycleState}'.`
        },
        { status: 409 }
      );
    }

    const activeAuditRun = await findActiveAuditRun(projectId);
    if (activeAuditRun) {
      return NextResponse.json(
        {
          error: "An audit is already running for this project.",
          activeAuditRunId: activeAuditRun.id
        },
        { status: 409 }
      );
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
