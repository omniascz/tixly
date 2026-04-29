import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Compares two TOTP code strings in constant time to prevent timing attacks.
 * Returns false immediately only on length mismatch (lengths are public anyway).
 */
function totpEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Generates a 32-byte cryptographically random TOTP secret.
 */
export function generateSecret(): Buffer {
  return randomBytes(32);
}

/**
 * Computes the TOTP counter value per RFC 6238:
 * C = floor(unix_ts / 30)
 */
function getCounter(timestamp: number): bigint {
  return BigInt(Math.floor(timestamp / 30));
}

/**
 * Encodes the counter as an 8-byte big-endian buffer, as required by RFC 6238.
 */
function counterToBuffer(counter: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(counter);
  return buf;
}

/**
 * RFC 6238 dynamic truncation on an HMAC-SHA256 digest (32 bytes).
 * Offset = last nibble of digest; extract 4 bytes from that offset,
 * mask the MSB, then take modulo 10^8 for an 8-digit value.
 */
function truncate(hmacResult: Buffer): number {
  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  const binCode =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);
  return binCode % 100_000_000; // 8 digits
}

/**
 * Generates an 8-digit TOTP for the given secret and optional timestamp (ms).
 * Defaults to Date.now().
 */
export function generateTOTP(secret: Buffer, timestamp: number = Date.now()): string {
  const counter = getCounter(Math.floor(timestamp / 1000));
  const counterBuf = counterToBuffer(counter);
  const hmac = createHmac("sha256", secret).update(counterBuf).digest();
  const code = truncate(hmac);
  return code.toString().padStart(8, "0");
}

/**
 * Verifies a TOTP token against the secret, allowing ±1 time-step window
 * to tolerate clock skew between client and server (RFC 6238 §5.2).
 */
export function verifyTOTP(
  secret: Buffer,
  token: string,
  timestamp: number = Date.now()
): boolean {
  if (!/^\d{8}$/.test(token)) {
    return false;
  }
  const nowSec = Math.floor(timestamp / 1000);
  for (const delta of [-1, 0, 1]) {
    const counter = getCounter(nowSec) + BigInt(delta);
    const counterBuf = counterToBuffer(counter);
    const hmac = createHmac("sha256", secret).update(counterBuf).digest();
    const code = truncate(hmac).toString().padStart(8, "0");
    if (totpEqual(code, token)) {
      return true;
    }
  }
  return false;
}
