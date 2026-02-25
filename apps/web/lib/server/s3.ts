import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getEnv } from "./env";

const globalForS3 = globalThis as unknown as {
  s3Client?: S3Client;
};

function getS3Client() {
  if (globalForS3.s3Client) {
    return globalForS3.s3Client;
  }

  const env = getEnv();
  const client = new S3Client({
    endpoint: env.MINIO_ENDPOINT,
    forcePathStyle: true,
    region: env.MINIO_REGION,
    credentials: {
      accessKeyId: env.MINIO_ACCESS_KEY,
      secretAccessKey: env.MINIO_SECRET_KEY
    }
  });

  if (env.NODE_ENV !== "production") {
    globalForS3.s3Client = client;
  }

  return client;
}

function getBucketName() {
  return getEnv().MINIO_BUCKET;
}

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

export async function createMultipartUpload(params: {
  key: string;
  contentType: string;
  metadata?: Record<string, string>;
}) {
  const s3Client = getS3Client();
  const command = new CreateMultipartUploadCommand({
    Bucket: getBucketName(),
    Key: params.key,
    ContentType: params.contentType,
    Metadata: params.metadata
  });

  return s3Client.send(command);
}

export async function getMultipartUploadPartSignedUrl(params: {
  key: string;
  uploadId: string;
  partNumber: number;
}) {
  const s3Client = getS3Client();
  const command = new UploadPartCommand({
    Bucket: getBucketName(),
    Key: params.key,
    UploadId: params.uploadId,
    PartNumber: params.partNumber
  });

  return getSignedUrl(s3Client, command, { expiresIn: 900 });
}

export async function getPutObjectSignedUrl(params: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}) {
  const s3Client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: params.key,
    ContentType: params.contentType
  });

  return getSignedUrl(s3Client, command, {
    expiresIn: params.expiresInSeconds ?? 900
  });
}

export async function completeMultipartUpload(params: {
  key: string;
  uploadId: string;
  parts: CompletedPart[];
}) {
  const s3Client = getS3Client();
  const command = new CompleteMultipartUploadCommand({
    Bucket: getBucketName(),
    Key: params.key,
    UploadId: params.uploadId,
    MultipartUpload: {
      Parts: params.parts
    }
  });

  return s3Client.send(command);
}

export async function getObjectSignedUrl(key: string, expiresInSeconds = 900) {
  const s3Client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key
  });

  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

export async function objectExists(key: string) {
  const s3Client = getS3Client();
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: getBucketName(),
        Key: key
      })
    );
    return true;
  } catch {
    return false;
  }
}

export async function putObject(params: {
  key: string;
  body: string | Uint8Array;
  contentType: string;
}) {
  const s3Client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: params.key,
    Body: params.body,
    ContentType: params.contentType
  });

  return s3Client.send(command);
}

export async function getObjectText(key: string): Promise<string | null> {
  const s3Client = getS3Client();
  let response;
  try {
    response = await s3Client.send(
      new GetObjectCommand({
        Bucket: getBucketName(),
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

  const streamText = await response.Body.transformToString();
  return streamText;
}
