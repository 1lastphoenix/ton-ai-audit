import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

import { env } from "./env";

export const s3Client = new S3Client({
  endpoint: env.MINIO_ENDPOINT,
  forcePathStyle: true,
  region: env.MINIO_REGION,
  credentials: {
    accessKeyId: env.MINIO_ACCESS_KEY,
    secretAccessKey: env.MINIO_SECRET_KEY
  }
});

function getS3ErrorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const metadata = (error as { $metadata?: unknown }).$metadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const statusCode = (metadata as { httpStatusCode?: unknown }).httpStatusCode;
  return typeof statusCode === "number" ? statusCode : null;
}

function getS3ErrorName(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

function isS3NotFoundError(error: unknown): boolean {
  const statusCode = getS3ErrorStatusCode(error);
  if (statusCode === 404) {
    return true;
  }

  const name = getS3ErrorName(error);
  return name === "NoSuchKey" || name === "NotFound" || name === "NoSuchBucket";
}

export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  let response;
  try {
    response = await s3Client.send(
      new GetObjectCommand({
        Bucket: env.MINIO_BUCKET,
        Key: key
      })
    );
  } catch (error) {
    if (isS3NotFoundError(error)) {
      return null;
    }

    throw error;
  }

  if (!response.Body) {
    return null;
  }

  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function getObjectText(key: string): Promise<string | null> {
  const buffer = await getObjectBuffer(key);
  if (!buffer) {
    return null;
  }
  return buffer.toString("utf8");
}

export async function putObject(params: {
  key: string;
  body: string | Uint8Array | Buffer;
  contentType: string;
}) {
  return s3Client.send(
    new PutObjectCommand({
      Bucket: env.MINIO_BUCKET,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType
    })
  );
}

export async function deleteObject(key: string) {
  return s3Client.send(
    new DeleteObjectCommand({
      Bucket: env.MINIO_BUCKET,
      Key: key
    })
  );
}
