/**
 * S3-compatible storage client (MinIO, D16). Same API works for R2.
 *
 * Backend-only — never import into a client component. Credentials come from
 * env (S3_ENDPOINT/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_BUCKET/S3_REGION/
 * S3_FORCE_PATH_STYLE). The frontend never touches storage directly; it gets
 * short-lived presigned URLs from the backend (docs/01 §2).
 */
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { GetObjectCommandOutput } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface S3Config {
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly region: string;
  readonly forcePathStyle: boolean;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name} (S3/MinIO).`);
  }
  return value;
}

export function getS3Config(): S3Config {
  return {
    endpoint: requireEnv('S3_ENDPOINT'),
    accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    bucket: requireEnv('S3_BUCKET'),
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  };
}

let cached: S3Client | undefined;

export function getS3Client(): S3Client {
  if (cached !== undefined) return cached;
  const cfg = getS3Config();
  cached = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return cached;
}

const PRESIGN_EXPIRY_SECONDS = 15 * 60; // 15 minutes (docs/01 §2)

/** Presigned URL to DOWNLOAD an object. */
export async function presignGet(key: string): Promise<string> {
  const { bucket } = getS3Config();
  return getSignedUrl(getS3Client(), new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: PRESIGN_EXPIRY_SECONDS,
  });
}

/** Presigned URL to UPLOAD an object. */
export async function presignPut(key: string, contentType?: string): Promise<string> {
  const { bucket } = getS3Config();
  return getSignedUrl(
    getS3Client(),
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn: PRESIGN_EXPIRY_SECONDS },
  );
}

/**
 * Upload object bytes server-side (the `/api/upload` receipt path — the frontend
 * never holds S3 creds, docs/01 §2). `body` is the raw file content.
 */
export async function putObject(
  key: string,
  body: Uint8Array | Buffer,
  contentType?: string,
): Promise<void> {
  const { bucket } = getS3Config();
  await getS3Client().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

/** Fetch an object's full bytes (worker-side, for text extraction). */
export async function getObjectBytes(key: string): Promise<Buffer> {
  const { bucket } = getS3Config();
  const res: GetObjectCommandOutput = await getS3Client().send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (res.Body === undefined) {
    throw new Error(`getObjectBytes: empty body for key "${key}"`);
  }
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

/** Move an object: server-side copy + delete (invisible to the user). */
export async function moveObject(sourceKey: string, destinationKey: string): Promise<void> {
  const { bucket } = getS3Config();
  const client = getS3Client();
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${sourceKey}`,
      Key: destinationKey,
    }),
  );
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: sourceKey }));
}
