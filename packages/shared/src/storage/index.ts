/**
 * Backend-only storage surface. Imported via `@gracie/shared/storage` so the
 * AWS S3 SDK is never pulled into the browser bundle.
 */
export {
  getS3Client,
  getS3Config,
  putObject,
  putObjectStream,
  getObjectBytes,
  getObjectStream,
  deleteObject,
  moveObject,
} from './s3.js';
export type { S3Config, ObjectStream } from './s3.js';
