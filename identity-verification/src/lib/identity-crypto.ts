/**
 * AES-256-GCM encryption / decryption for PII fields.
 *
 * Key source: process.env.IDENTITY_ENCRYPTION_KEY
 *   Must be a 64-character hex string (32 bytes).
 *
 * Stored format:  base64( iv[12 bytes] || ciphertext || authTag[16 bytes] )
 *
 * No third-party dependencies — uses Node.js built-in `crypto` module only.
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';
import { IdentityError, IdentityErrorCode } from './identity-errors.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;    // 96-bit IV recommended for GCM
const TAG_LENGTH = 16;   // 128-bit auth tag

function getKey(): Buffer {
  const hex = process.env.IDENTITY_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new IdentityError(
      IdentityErrorCode.ENCRYPTION_KEY_MISSING,
      'IDENTITY_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)',
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt plaintext PII.
 * @returns base64-encoded string: iv || ciphertext || authTag
 */
export function encryptPii(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Layout: iv (12) || ciphertext (variable) || tag (16)
  const combined = Buffer.concat([iv, ciphertext, tag]);
  return combined.toString('base64');
}

/**
 * Decrypt a base64-encoded PII blob produced by encryptPii.
 * Throws if the key is missing or the data is corrupted / tampered.
 */
export function decryptPii(encoded: string): string {
  const key = getKey();
  const combined = Buffer.from(encoded, 'base64');

  if (combined.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Identity crypto: ciphertext blob is too short to be valid');
  }

  const iv         = combined.subarray(0, IV_LENGTH);
  const tag        = combined.subarray(combined.length - TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH, combined.length - TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/**
 * GDPR-compliant identity hash.
 *
 * Computes HMAC-SHA256 of a normalized birth number using a server-side salt.
 * The raw birth number is NEVER stored or logged — only the resulting hash
 * is persisted for deduplication and per-event purchase-limit enforcement.
 *
 * The `salt` argument is required (caller must pass `process.env.IDENTITY_HASH_SALT`
 * or equivalent) to keep this function pure and trivially testable.
 *
 * @param birthNumber raw Czech rodné číslo (digits, may contain slash)
 * @param salt        server-side secret salt (>= 32 chars recommended)
 * @returns 64-char lowercase hex string (HMAC-SHA256)
 */
export function hashIdentity(birthNumber: string, salt: string): string {
  if (!birthNumber) {
    throw new Error('hashIdentity: birthNumber is required');
  }
  if (!salt || salt.length < 16) {
    throw new Error('hashIdentity: salt must be at least 16 characters');
  }
  // Normalize: strip non-digits so "991231/1234" and "9912311234" hash equal.
  const normalized = birthNumber.replace(/\D/g, '');
  return createHmac('sha256', salt).update(normalized).digest('hex');
}

