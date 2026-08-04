/**
 * S3-compatible storage client (MinIO, D16). Same API works for R2.
 *
 * Backend-only — never import into a client component. Credentials come from
 * env (S3_ENDPOINT/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_BUCKET/S3_REGION/
 * S3_FORCE_PATH_STYLE). MinIO is internal-only; the frontend never touches storage
 * directly and never receives a presigned URL — object bytes are streamed to it
 * through same-origin app routes (`/api/files/raw`, `/api/files/content`), docs/01 §2.
 */
import { Readable } from 'node:stream';

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { GetObjectCommandOutput } from '@aws-sdk/client-s3';

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

/**
 * Stream a body of KNOWN length straight to storage without buffering it in
 * memory (the recorded-meeting MP4 path, Phase C). `body` is a Node `Readable`
 * (e.g. the downloaded Recall video piped through) and `contentLength` MUST be the
 * exact byte count — the S3 client needs it to send a single-PUT streaming body
 * rather than reading the whole stream to measure it. Use {@link putObject} when
 * the bytes are already in memory.
 */
export async function putObjectStream(
  key: string,
  body: Readable,
  contentLength: number,
  contentType?: string,
): Promise<void> {
  const { bucket } = getS3Config();
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentLength: contentLength,
      ContentType: contentType,
    }),
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

/** Raw object stream + the metadata a proxy route needs to set response headers. */
export interface ObjectStream {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string | undefined;
  /** Byte length of THIS response (the partial length when a range was served). */
  readonly contentLength: number | undefined;
  /** `bytes <start>-<end>/<total>` when a range was served, else undefined. */
  readonly contentRange: string | undefined;
  /** 206 when a byte range was served, else 200. */
  readonly statusCode: 200 | 206;
}

/**
 * Stream an object's bytes (the same-origin download/preview proxy path). The
 * frontend never receives an internal-MinIO presigned URL for a GET; it fetches
 * this through the app instead. Node runtime only — `Body` is a Node `Readable`,
 * converted to a web `ReadableStream` so a route handler can return it directly
 * without buffering the whole file.
 *
 * Pass the request's `Range` header to serve a byte range (HTTP 206): HTML5
 * `<video>` seeking (the meeting-page recording player) depends on range support —
 * without it the browser treats the resource as non-seekable and click-to-seek
 * breaks. Forwarded straight to S3/MinIO, which returns the partial body +
 * `Content-Range`.
 */
export async function getObjectStream(
  key: string,
  range?: string | null,
): Promise<ObjectStream> {
  const { bucket } = getS3Config();
  const res: GetObjectCommandOutput = await getS3Client().send(
    new GetObjectCommand({ Bucket: bucket, Key: key, Range: range ?? undefined }),
  );
  if (res.Body === undefined) {
    throw new Error(`getObjectStream: empty body for key "${key}"`);
  }
  const served206 = range != null && range !== '' && res.ContentRange !== undefined;
  return {
    body: Readable.toWeb(res.Body as Readable) as ReadableStream<Uint8Array>,
    contentType: res.ContentType,
    contentLength: res.ContentLength,
    contentRange: res.ContentRange,
    statusCode: served206 ? 206 : 200,
  };
}

/** Delete an object by key (e.g. when a Knowledge Base document is removed). */
export async function deleteObject(key: string): Promise<void> {
  const { bucket } = getS3Config();
  await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
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
