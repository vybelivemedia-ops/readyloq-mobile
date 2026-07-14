/**
 * AES-256-GCM encryption for OAuth tokens stored at rest.
 *
 * Setup:
 *   1. Generate key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   2. Add output as OAUTH_ENCRYPTION_KEY in Replit Secrets (must be 64 hex chars)
 *
 * Wire format (base64): [12-byte IV][16-byte GCM auth tag][ciphertext]
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_BYTES = 32;

function getKey(): Buffer {
  const raw = process.env["OAUTH_ENCRYPTION_KEY"];
  if (!raw) {
    throw new Error(
      "OAUTH_ENCRYPTION_KEY is not set. " +
      'Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" ' +
      "then add to Replit Secrets."
    );
  }
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== KEY_BYTES) {
    throw new Error(`OAUTH_ENCRYPTION_KEY must be 64 hex chars (${KEY_BYTES} bytes). Got ${buf.length}.`);
  }
  return buf;
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptToken(ciphertext: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
  // Explicitly set authTagLength to enforce the expected 16-byte GCM tag.
  // setAuthTag() verifies the tag during final() — decryption fails if tampered.
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function isEncryptionConfigured(): boolean {
  const raw = process.env["OAUTH_ENCRYPTION_KEY"];
  if (!raw) return false;
  return Buffer.from(raw, "hex").length === KEY_BYTES;
}
