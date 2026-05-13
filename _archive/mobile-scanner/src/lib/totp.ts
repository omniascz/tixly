// ---------------------------------------------------------------------------
// TOTP implementation for React Native / Expo
// Ported from totp-qr/src/lib/totp.ts — replaced Node.js crypto with
// Web Crypto API (crypto.subtle) available in React Native's Hermes runtime.
// Uses HMAC-SHA256, step=30s, 8 digits, window=±1.
// ---------------------------------------------------------------------------

/**
 * Constant-time string comparison for TOTP codes.
 * Lengths are not secret (always 8 digits), so early-exit on length mismatch
 * is acceptable and matches the original.
 */
function totpEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Computes the TOTP counter (RFC 6238): floor(unix_seconds / 30).
 */
function getCounter(timestampSec: number): bigint {
  return BigInt(Math.floor(timestampSec / 30));
}

/**
 * Encodes a counter value as an 8-byte big-endian Uint8Array.
 */
function counterToBytes(counter: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  return buf;
}

/**
 * RFC 6238 dynamic truncation on a 32-byte HMAC-SHA256 digest.
 * Returns an 8-digit integer.
 */
function truncate(digest: Uint8Array): number {
  const offset = digest[digest.length - 1] & 0x0f;
  const binCode =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return binCode % 100_000_000; // 8 digits
}

/**
 * Imports a raw secret key for HMAC-SHA256 via Web Crypto API.
 */
async function importKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/**
 * Computes HMAC-SHA256(key, data) and returns the raw digest bytes.
 */
async function hmacSha256(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return new Uint8Array(sig);
}

/**
 * Generates an 8-digit TOTP for the given secret and optional timestamp (ms).
 * Defaults to Date.now().
 */
export async function generateTOTP(
  secret: Uint8Array,
  timestamp: number = Date.now()
): Promise<string> {
  const counter = getCounter(Math.floor(timestamp / 1000));
  const counterBytes = counterToBytes(counter);
  const key = await importKey(secret);
  const digest = await hmacSha256(key, counterBytes);
  const code = truncate(digest);
  return code.toString().padStart(8, "0");
}

/**
 * Verifies a TOTP token against the secret, allowing ±1 time-step window
 * to tolerate clock skew between client and server (RFC 6238 §5.2).
 */
export async function verifyTOTP(
  secret: Uint8Array,
  token: string,
  timestamp: number = Date.now()
): Promise<boolean> {
  if (!/^\d{8}$/.test(token)) {
    return false;
  }
  const nowSec = Math.floor(timestamp / 1000);
  const key = await importKey(secret);

  for (const delta of [-1, 0, 1]) {
    const counter = getCounter(nowSec) + BigInt(delta);
    const counterBytes = counterToBytes(counter);
    const digest = await hmacSha256(key, counterBytes);
    const code = truncate(digest).toString().padStart(8, "0");
    if (totpEqual(code, token)) {
      return true;
    }
  }
  return false;
}
