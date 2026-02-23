import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

export async function createMultipartUpload(params: {
  key: string;
  contentType: string;
  metadata?: Record<string, string>;
}) {
  const command = new CreateMultipartUploadCommand({
    Bucket: env.MINIO_BUCKET,
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
  const command = new UploadPartCommand({
    Bucket: env.MINIO_BUCKET,
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
  const command = new PutObjectCommand({
    Bucket: env.MINIO_BUCKET,
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
  const command = new CompleteMultipartUploadCommand({
    Bucket: env.MINIO_BUCKET,
    Key: params.key,
    UploadId: params.uploadId,
    MultipartUpload: {
      Parts: params.parts
    }
  });

  return s3Client.send(command);
}

export async function getObjectSignedUrl(key: string, expiresInSeconds = 900) {
  const command = new GetObjectCommand({
    Bucket: env.MINIO_BUCKET,
    Key: key
  });

  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

export async function putObject(params: {
  key: string;
  body: string | Uint8Array;
  contentType: string;
}) {
  const command = new PutObjectCommand({
    Bucket: env.MINIO_BUCKET,
    Key: params.key,
    Body: params.body,
    ContentType: params.contentType
  });

  return s3Client.send(command);
}

export async function deleteObject(key: string) {
  return s3Client.send(
    new DeleteObjectCommand({
      Bucket: env.MINIO_BUCKET,
      Key: key
    })
  );
}

export async function getObjectText(key: string): Promise<string | null> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: env.MINIO_BUCKET,
      Key: key
    })
  );

  if (!response.Body) {
    return null;
  }

  const streamText = await response.Body.transformToString();
  return streamText;
}
