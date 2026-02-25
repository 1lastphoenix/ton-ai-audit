import { NextResponse } from "next/server";

import { and, eq } from "drizzle-orm";

import { uploadCompleteSchema, uploads } from "@ton-audit/shared";

import { parseJsonBody, requireSession, toApiErrorResponse } from "@/lib/server/api";
import { ensureProjectAccess } from "@/lib/server/domain";
import { db } from "@/lib/server/db";
import { completeMultipartUpload, objectExists, putObject } from "@/lib/server/s3";

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

    if (upload.type === "zip") {
      if (upload.multipartUploadId) {
        if (!body.eTags.length) {
          return NextResponse.json({ error: "Missing multipart eTags" }, { status: 400 });
        }

        await completeMultipartUpload({
          key: upload.s3Key,
          uploadId: upload.multipartUploadId,
          parts: body.eTags.map((item) => ({
            ETag: item.eTag,
            PartNumber: item.partNumber
          }))
        });
      } else {
        const exists = await objectExists(upload.s3Key);
        if (!exists) {
          return NextResponse.json({ error: "Uploaded object is missing in storage" }, { status: 400 });
        }
      }
    } else {
      const metadataFiles = Array.isArray((upload.metadata as { files?: unknown[] } | null)?.files)
        ? ((upload.metadata as { files: Array<Record<string, unknown>> }).files ?? [])
        : [];

      if (metadataFiles.length === 0) {
        return NextResponse.json({ error: "Upload manifest is empty" }, { status: 400 });
      }

      const completedPathSet = new Set(body.completedFiles.map((file) => file.path));
      for (const file of metadataFiles) {
        const expectedPath = typeof file.path === "string" ? file.path : null;
        const expectedKey = typeof file.s3Key === "string" ? file.s3Key : null;
        if (!expectedPath || !expectedKey) {
          return NextResponse.json({ error: "Upload manifest is invalid" }, { status: 400 });
        }
        if (!completedPathSet.has(expectedPath)) {
          return NextResponse.json(
            { error: `Missing completed file for ${expectedPath}` },
            { status: 400 }
          );
        }

        const exists = await objectExists(expectedKey);
        if (!exists) {
          return NextResponse.json(
            { error: `File object missing in storage for ${expectedPath}` },
            { status: 400 }
          );
        }
      }

      await putObject({
        key: upload.s3Key,
        body: JSON.stringify(
          {
            files: metadataFiles,
            completedFiles: body.completedFiles,
            completedAt: new Date().toISOString()
          },
          null,
          2
        ),
        contentType: "application/json"
      });
    }

    const [updated] = await db
      .update(uploads)
      .set({
        status: "uploaded",
        metadata:
          upload.type === "file-set"
            ? {
                ...(upload.metadata as Record<string, unknown>),
                completedFiles: body.completedFiles
              }
            : upload.metadata,
        updatedAt: new Date()
      })
      .where(eq(uploads.id, upload.id))
      .returning();

    return NextResponse.json({ upload: updated });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
