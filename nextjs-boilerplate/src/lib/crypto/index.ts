import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) throw new Error('ENCRYPTION_KEY not set');
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  // V produkci NEakceptujeme libovolný řetězec stretchovaný přes sha256 —
  // tichý sha256(„changeme") = slabý klíč bez entropického dna. Vyžaduj
  // 32bytový klíč jako 64 hex znaků (openssl rand -hex 32).
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'ENCRYPTION_KEY must be 64 hex chars (32 bytes) in production — generate with `openssl rand -hex 32`.',
    );
  }
  return createHash('sha256').update(hex).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

export function decryptSecret(encoded: string): string {
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) throw new Error('Invalid ciphertext');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
