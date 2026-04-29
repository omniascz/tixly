/**
 * @tixly/crypto
 *
 * Shared AES-256-GCM encryption utilities for the Tixly platform.
 *
 * Veřejné API modulu:
 * - `encryptSecret` — zašifruje buffer pomocí AES-256-GCM s AAD vazbou na ticketId
 * - `decryptSecret` — dešifruje buffer, ověří auth tag a AAD
 * - typ: EncryptedSecret
 *
 * Requires the `TOTP_MASTER_KEY` environment variable (32 bytes / 64 hex chars).
 *
 * @example
 * import { encryptSecret, decryptSecret } from '@tixly/crypto';
 *
 * const { encrypted, iv } = await encryptSecret(secretBuf, ticketId);
 * const plain = await decryptSecret(encrypted, iv, ticketId);
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes,
} from "crypto";

const ALGORITHM: CipherGCMTypes = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

function getMasterKey(): Buffer {
  const hex = process.env.TOTP_MASTER_KEY;
  if (!hex) {
    throw new Error(
      "TOTP_MASTER_KEY environment variable is not set"
    );
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error(
      "TOTP_MASTER_KEY must be exactly 32 bytes (64 hex characters)"
    );
  }
  return key;
}

export interface EncryptedSecret {
  encrypted: Buffer;
  iv: Buffer;
}

/**
 * Encrypts a TOTP secret with AES-256-GCM.
 * ticketId is used as Additional Authenticated Data (AAD) to bind the
 * ciphertext to a specific ticket — decryption with a different ticketId
 * will fail the authentication tag check even if the ciphertext is intact.
 */
export async function encryptSecret(
  secret: Buffer,
  ticketId: string
): Promise<EncryptedSecret> {
  const masterKey = getMasterKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, masterKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  cipher.setAAD(Buffer.from(ticketId, "utf8"));

  const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Append the 16-byte auth tag to the ciphertext so it is stored together.
  return {
    encrypted: Buffer.concat([encrypted, authTag]),
    iv,
  };
}

/**
 * Decrypts an AES-256-GCM encrypted TOTP secret.
 * Will throw if the auth tag does not match — either the data was tampered
 * with or the wrong ticketId / master key was supplied.
 */
export async function decryptSecret(
  encryptedWithTag: Buffer,
  iv: Buffer,
  ticketId: string
): Promise<Buffer> {
  const masterKey = getMasterKey();

  if (encryptedWithTag.length < AUTH_TAG_LENGTH) {
    throw new Error("DECRYPT_FAILED: ciphertext too short to contain auth tag");
  }

  const authTag = encryptedWithTag.subarray(
    encryptedWithTag.length - AUTH_TAG_LENGTH
  );
  const encrypted = encryptedWithTag.subarray(
    0,
    encryptedWithTag.length - AUTH_TAG_LENGTH
  );

  const decipher = createDecipheriv(ALGORITHM, masterKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  decipher.setAAD(Buffer.from(ticketId, "utf8"));
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted;
  } catch {
    throw new Error(
      "DECRYPT_FAILED: authentication tag mismatch — data may be tampered or wrong ticketId"
    );
  }
}
