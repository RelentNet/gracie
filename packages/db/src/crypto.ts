/**
 * Symmetric encryption for integration secrets at rest (docs/07).
 *
 * AES-256-GCM with APP_ENCRYPTION_KEY (32 bytes, base64). Ciphertext is stored in
 * `integration_credentials.secret_encrypted` (bytea), encoded as the Postgres hex
 * literal (\x...). Bundle layout: iv(12) | authTag(16) | ciphertext.
 *
 * Server-only — the key never leaves the backend.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function encryptionKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (raw === undefined || raw === '') {
    throw new Error(
      'Missing APP_ENCRYPTION_KEY (32-byte base64). Generate: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded).');
  }
  return buf;
}

/** Encrypt UTF-8 plaintext → Postgres bytea hex literal (\x...). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const bundle = Buffer.concat([iv, cipher.getAuthTag(), data]);
  return `\\x${bundle.toString('hex')}`;
}

/** Decrypt a Postgres bytea hex literal (\x...) → UTF-8 plaintext. */
export function decryptSecret(stored: string): string {
  const hex = stored.startsWith('\\x') ? stored.slice(2) : stored;
  const bundle = Buffer.from(hex, 'hex');
  const iv = bundle.subarray(0, IV_BYTES);
  const tag = bundle.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const data = bundle.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
