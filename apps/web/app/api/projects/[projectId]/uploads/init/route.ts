import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";

import { and, eq } from "drizzle-orm";

import { acceptedUploadExtensions, normalizePath, uploadInitSchema, uploads } from "@ton-audit/shared";

import { checkRateLimit, parseJsonBody, requireSession, toApiErrorResponse } from "@/lib/server/api";
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
    // 20 upload initiations per minute per user.
    await checkRateLimit(session.user.id, "upload-init", 20, 60_000);

    const project = await ensureProjectAccess(projectId, session.user.id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const body = await parseJsonBody(request, uploadInitSchema);

    const validateAllowedExtension = (targetPath: string) => {
      const extension = path.extname(targetPath).toLowerCase();
      return acceptedUploadExtensions.includes(extension as (typeof acceptedUploadExtensions)[number]);
    };

    const validateAllowedMime = (mime: string) => {
      const allowedMimePrefixes = ["text/", "application/json", "application/javascript"];
      const allowedMimes = new Set([
        "application/zip",
        "application/octet-stream",
        "application/x-zip-compressed",
        "application/x-typescript"
      ]);

      return allowedMimes.has(mime) || allowedMimePrefixes.some((prefix) => mime.startsWith(prefix));
    };

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
    const isZipUpload = body.type === "zip";

    if (isZipUpload && body.sizeBytes > env.UPLOAD_MAX_BYTES) {
      return NextResponse.json(
        { error: `Upload exceeds ${env.UPLOAD_MAX_BYTES} bytes limit` },
        { status: 400 }
      );
    }

    let multipartUploadId: string | null = null;
    let partUrls: { partNumber: number; url: string }[] = [];
    let singleUrl: string | null = null;
    const fileUrls: Array<{ path: string; key: string; url: string }> = [];

    if (isZipUpload) {
      if (!validateAllowedExtension(body.filename)) {
        return NextResponse.json({ error: "Unsupported file extension" }, { status: 400 });
      }
      if (!validateAllowedMime(body.contentType || "application/octet-stream")) {
        return NextResponse.json({ error: "Unsupported content type" }, { status: 400 });
      }

      const objectKey = `uploads/${projectId}/${uploadId}/${body.filename}`;

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
          parts: body.parts,
          mode: "zip"
        }
      });
    } else {
      if (body.files.length > env.UPLOAD_MAX_FILES) {
        return NextResponse.json(
          { error: `Upload exceeds ${env.UPLOAD_MAX_FILES} files limit` },
          { status: 400 }
        );
      }

      if (body.totalSizeBytes > env.UPLOAD_MAX_BYTES) {
        return NextResponse.json(
          { error: `Upload exceeds ${env.UPLOAD_MAX_BYTES} bytes limit` },
          { status: 400 }
        );
      }

      const normalizedFiles = body.files.map((file, index) => {
        const normalizedPath = normalizePath(file.path);
        if (!normalizedPath || normalizedPath.includes("..")) {
          throw new Error(`Unsafe file path: ${file.path}`);
        }
        if (!validateAllowedExtension(normalizedPath)) {
          throw new Error(`Unsupported extension for ${file.path}`);
        }
        if (!validateAllowedMime(file.contentType || "application/octet-stream")) {
          throw new Error(`Unsupported content type for ${file.path}`);
        }

        const key = `uploads/${projectId}/${uploadId}/files/${index + 1}-${path.basename(normalizedPath)}`;
        return {
          path: normalizedPath,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          key
        };
      });

      for (const file of normalizedFiles) {
        const url = await getPutObjectSignedUrl({
          key: file.key,
          contentType: file.contentType
        });
        fileUrls.push({
          path: file.path,
          key: file.key,
          url
        });
      }

      const manifestKey = `uploads/${projectId}/${uploadId}/manifest.json`;
      await db.insert(uploads).values({
        id: uploadId,
        projectId,
        uploaderUserId: session.user.id,
        type: "file-set",
        status: "initialized",
        s3Key: manifestKey,
        multipartUploadId: null,
        sizeBytes: body.totalSizeBytes,
        contentType: "application/json",
        originalFilename: "file-set.json",
        metadata: {
          mode: "file-set",
          files: normalizedFiles.map((file) => ({
            path: file.path,
            s3Key: file.key,
            contentType: file.contentType,
            sizeBytes: file.sizeBytes
          }))
        }
      });
    }

    return NextResponse.json({
      uploadId,
      key: isZipUpload ? `uploads/${projectId}/${uploadId}/${body.filename}` : `uploads/${projectId}/${uploadId}/manifest.json`,
      multipartUploadId,
      singleUrl,
      partUrls,
      fileUrls
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
