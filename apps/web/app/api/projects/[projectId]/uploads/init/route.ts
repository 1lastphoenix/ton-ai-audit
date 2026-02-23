import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { and, eq } from "drizzle-orm";

import { uploadInitSchema, uploads } from "@ton-audit/shared";

import { parseJsonBody, requireSession, toApiErrorResponse } from "@/lib/server/api";
import { ensureProjectAccess } from "@/lib/server/domain";
import { db } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import {
  createMultipartUpload,
  getMultipartUploadPartSignedUrl,
  getPutObjectSignedUrl
} from "@/lib/server/s3";

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

    const body = await parseJsonBody(request, uploadInitSchema);

    if (body.sizeBytes > env.UPLOAD_MAX_BYTES) {
      return NextResponse.json(
        { error: `Upload exceeds ${env.UPLOAD_MAX_BYTES} bytes limit` },
        { status: 400 }
      );
    }

    const activeUploads = await db
      .select({ id: uploads.id })
      .from(uploads)
      .where(and(eq(uploads.projectId, projectId), eq(uploads.status, "initialized")));

    if (activeUploads.length >= env.UPLOAD_MAX_FILES) {
      return NextResponse.json(
        { error: `Upload count exceeds ${env.UPLOAD_MAX_FILES} file limit` },
        { status: 400 }
      );
    }

    const uploadId = randomUUID();
    const objectKey = `uploads/${projectId}/${uploadId}/${body.filename}`;

    let multipartUploadId: string | null = null;
    let partUrls: { partNumber: number; url: string }[] = [];
    let singleUrl: string | null = null;

    if (body.parts > 1) {
      const multipart = await createMultipartUpload({
        key: objectKey,
        contentType: body.contentType,
        metadata: {
          projectId,
          uploaderUserId: session.user.id
        }
      });

      if (!multipart.UploadId) {
        throw new Error("Failed to initialize multipart upload");
      }

      multipartUploadId = multipart.UploadId;
      const activeMultipartUploadId = multipart.UploadId;
      partUrls = await Promise.all(
        Array.from({ length: body.parts }, (_, index) =>
          getMultipartUploadPartSignedUrl({
            key: objectKey,
            uploadId: activeMultipartUploadId,
            partNumber: index + 1
          }).then((url) => ({ partNumber: index + 1, url }))
        )
      );
    } else {
      singleUrl = await getPutObjectSignedUrl({
        key: objectKey,
        contentType: body.contentType
      });
    }

    await db.insert(uploads).values({
      id: uploadId,
      projectId,
      uploaderUserId: session.user.id,
      type: body.type,
      status: "initialized",
      s3Key: objectKey,
      multipartUploadId,
      sizeBytes: body.sizeBytes,
      contentType: body.contentType,
      originalFilename: body.filename,
      metadata: {
        parts: body.parts
      }
    });

    return NextResponse.json({
      uploadId,
      key: objectKey,
      multipartUploadId,
      singleUrl,
      partUrls
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
