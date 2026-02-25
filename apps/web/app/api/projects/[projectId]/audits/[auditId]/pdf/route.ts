import { NextResponse } from "next/server";

import { requireSession, toApiErrorResponse } from "@/lib/server/api";
import {
  createPdfExport,
  ensureProjectAccess,
  findAuditRunWithProject,
  getPdfExportByAudit
} from "@/lib/server/domain";
import { enqueueJob } from "@/lib/server/queues";
import { getObjectSignedUrl } from "@/lib/server/s3";

const PDF_ENQUEUE_COOLDOWN_MS = 30_000;
const PDF_QUEUED_STALE_MS = 5 * 60_000;

export async function POST(
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

    if (audit.status !== "completed" || !audit.reportJson) {
      return NextResponse.json(
        {
          error: "Audit report is not ready yet. Wait for a completed audit before exporting PDF."
        },
        { status: 409 }
      );
    }

    const existingPdf = await getPdfExportByAudit(audit.id);
    if (existingPdf?.status === "completed" && existingPdf.s3Key) {
      return NextResponse.json(
        {
          jobId: null,
          status: "completed",
          queued: false
        },
        { status: 200 }
      );
    }

    const now = Date.now();
    const lastUpdatedAt =
      existingPdf?.updatedAt instanceof Date ? existingPdf.updatedAt.getTime() : 0;
    const ageMs = lastUpdatedAt ? now - lastUpdatedAt : Number.POSITIVE_INFINITY;

    if (existingPdf?.status === "running") {
      return NextResponse.json(
        {
          jobId: null,
          status: "running",
          queued: false
        },
        { status: 202 }
      );
    }

    if (existingPdf?.status === "queued" && ageMs < PDF_QUEUED_STALE_MS) {
      return NextResponse.json(
        {
          jobId: null,
          status: "queued",
          queued: false
        },
        { status: 202 }
      );
    }

    if (existingPdf && ageMs < PDF_ENQUEUE_COOLDOWN_MS) {
      return NextResponse.json(
        {
          jobId: null,
          status: existingPdf.status,
          queued: false
        },
        { status: 202 }
      );
    }

    await createPdfExport(audit.id);

    const enqueueWindow = Math.floor(now / PDF_ENQUEUE_COOLDOWN_MS);
    const uniqueJobId = `pdf:${projectId}:${audit.id}:${enqueueWindow}`;
    const job = await enqueueJob(
      "pdf",
      {
        projectId,
        auditRunId: audit.id,
        requestedByUserId: session.user.id
      },
      uniqueJobId
    );

    return NextResponse.json(
      {
        jobId: job.id,
        status: "queued",
        queued: true
      },
      { status: 202 }
    );
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

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

    const pdf = await getPdfExportByAudit(audit.id);

    if (!pdf || pdf.status !== "completed" || !pdf.s3Key) {
      return NextResponse.json({
        status: pdf?.status ?? "queued",
        url: null
      });
    }

    const url = await getObjectSignedUrl(pdf.s3Key, 600);

    return NextResponse.json({
      status: pdf.status,
      url
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
