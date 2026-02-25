import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { createRevisionFromUploadSchema, uploads } from "@ton-audit/shared";

import { parseJsonBody, requireSession, toApiErrorResponse } from "@/lib/server/api";
import {
  createRevisionFromUpload,
  ensureProjectAccess,
  findActiveAuditRun
} from "@/lib/server/domain";
import { db } from "@/lib/server/db";
import { enqueueJob } from "@/lib/server/queues";

export async function POST(
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

    const body = await parseJsonBody(request, createRevisionFromUploadSchema);
    const { revision } = await createRevisionFromUpload({
      projectId,
      uploadId: body.uploadId,
      createdByUserId: session.user.id
    });

    await db
      .update(uploads)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(uploads.id, body.uploadId));

    const job = await enqueueJob(
      "ingest",
      {
        projectId,
        revisionId: revision.id,
        uploadId: body.uploadId,
        requestedByUserId: session.user.id
      },
      `ingest:${projectId}:${revision.id}`
    );

    return NextResponse.json({
      revision,
      jobId: job.id
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
