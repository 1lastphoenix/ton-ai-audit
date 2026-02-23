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

export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: env.MINIO_BUCKET,
      Key: key
    })
  );

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
