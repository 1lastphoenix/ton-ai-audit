import { NextResponse } from "next/server";

import { pdfExportRequestSchema, type PdfExportVariant } from "@ton-audit/shared";

import { checkRateLimit, requireSession, toApiErrorResponse } from "@/lib/server/api";
import {
  createPdfExport,
  ensureProjectAccess,
  findAuditRunWithProject,
  getPdfExportByAudit
} from "@/lib/server/domain";
import { enqueueJob, queues } from "@/lib/server/queues";
import { getObjectSignedUrl } from "@/lib/server/s3";

const PDF_ENQUEUE_COOLDOWN_MS = 30_000;
const PDF_IN_FLIGHT_SCAN_LIMIT = 256;

function parsePdfVariant(rawValue: unknown): PdfExportVariant {
  const parsed = pdfExportRequestSchema.safeParse({ variant: rawValue ?? "client" });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  return parsed.data.variant;
}

async function resolvePdfVariant(
  request: Request,
  options: { allowBody: boolean }
): Promise<PdfExportVariant> {
  const queryVariant = new URL(request.url).searchParams.get("variant");
  if (queryVariant !== null) {
    return parsePdfVariant(queryVariant);
  }

  if (options.allowBody && request.headers.get("content-type")?.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as unknown;
    const parsed = pdfExportRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
    }
    return parsed.data.variant;
  }

  return "client";
}

async function findInFlightPdfJob(
  projectId: string,
  auditRunId: string,
  variant: PdfExportVariant
) {
  const jobs = await queues.pdf.getJobs(
    ["active", "waiting", "delayed", "prioritized", "waiting-children"],
    0,
    PDF_IN_FLIGHT_SCAN_LIMIT,
    true
  );

  return (
    jobs.find((job) => {
      const payload = job.data as { projectId?: unknown; auditRunId?: unknown; variant?: unknown };
      const jobVariant =
        typeof payload.variant === "string" ? payload.variant : "client";
      return (
        payload.projectId === projectId &&
        payload.auditRunId === auditRunId &&
        jobVariant === variant
      );
    }) ?? null
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; auditId: string }> }
) {
  try {
    const variant = await resolvePdfVariant(request, { allowBody: true });
    const session = await requireSession(request);
    // 20 export requests per 10 minutes per user.
    checkRateLimit(session.user.id, "export-pdf", 20, 10 * 60_000);
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

    const existingPdf = await getPdfExportByAudit(audit.id, variant);
    if (existingPdf?.status === "completed" && existingPdf.s3Key) {
      return NextResponse.json(
        {
          jobId: null,
          status: "completed",
          queued: false,
          variant
        },
        { status: 200 }
      );
    }

    const now = Date.now();
    const lastUpdatedAt =
      existingPdf?.updatedAt instanceof Date ? existingPdf.updatedAt.getTime() : 0;
    const ageMs = lastUpdatedAt ? now - lastUpdatedAt : Number.POSITIVE_INFINITY;
    const inFlightJob = await findInFlightPdfJob(projectId, audit.id, variant);

    if (inFlightJob) {
      return NextResponse.json(
        {
          jobId: String(inFlightJob.id),
          status: existingPdf?.status === "running" ? "running" : "queued",
          queued: false,
          variant
        },
        { status: 202 }
      );
    }

    if (existingPdf?.status === "running" && ageMs < PDF_ENQUEUE_COOLDOWN_MS) {
      return NextResponse.json(
        {
          jobId: null,
          status: "running",
          queued: false,
          variant
        },
        { status: 202 }
      );
    }

    if (existingPdf?.status === "queued" && ageMs < PDF_ENQUEUE_COOLDOWN_MS) {
      return NextResponse.json(
        {
          jobId: null,
          status: "queued",
          queued: false,
          variant
        },
        { status: 202 }
      );
    }

    if (existingPdf?.status === "failed" && ageMs < PDF_ENQUEUE_COOLDOWN_MS) {
      return NextResponse.json(
        {
          jobId: null,
          status: "failed",
          queued: false,
          variant
        },
        { status: 202 }
      );
    }

    await createPdfExport(audit.id, variant);

    const uniqueJobId = `pdf:${projectId}:${audit.id}:${variant}:${crypto.randomUUID()}`;
    const job = await enqueueJob(
      "pdf",
      {
        projectId,
        auditRunId: audit.id,
        variant,
        requestedByUserId: session.user.id
      },
      uniqueJobId
    );

    return NextResponse.json(
      {
        jobId: job.id,
        status: "queued",
        queued: true,
        variant
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
    const variant = await resolvePdfVariant(request, { allowBody: false });
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

    const pdf = await getPdfExportByAudit(audit.id, variant);

    if (!pdf || pdf.status !== "completed" || !pdf.s3Key) {
      return NextResponse.json({
        status: pdf?.status ?? "queued",
        variant,
        url: null
      });
    }

    const url = await getObjectSignedUrl(pdf.s3Key, 600);

    return NextResponse.json({
      status: pdf.status,
      variant,
      url
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
