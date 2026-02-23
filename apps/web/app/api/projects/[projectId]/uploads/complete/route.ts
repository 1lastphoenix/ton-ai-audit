import { NextResponse } from "next/server";

import { and, eq } from "drizzle-orm";

import { uploadCompleteSchema, uploads } from "@ton-audit/shared";

import { parseJsonBody, requireSession, toApiErrorResponse } from "@/lib/server/api";
import { ensureProjectAccess } from "@/lib/server/domain";
import { db } from "@/lib/server/db";
import { completeMultipartUpload } from "@/lib/server/s3";

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

    const body = await parseJsonBody(request, uploadCompleteSchema);

    const upload = await db.query.uploads.findFirst({
      where: and(eq(uploads.id, body.uploadId), eq(uploads.projectId, projectId))
    });

    if (!upload) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }

    if (upload.multipartUploadId && body.eTags.length) {
      await completeMultipartUpload({
        key: upload.s3Key,
        uploadId: upload.multipartUploadId,
        parts: body.eTags.map((item) => ({
          ETag: item.eTag,
          PartNumber: item.partNumber
        }))
      });
    }

    const [updated] = await db
      .update(uploads)
      .set({
        status: "uploaded",
        updatedAt: new Date()
      })
      .where(eq(uploads.id, upload.id))
      .returning();

    return NextResponse.json({ upload: updated });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}