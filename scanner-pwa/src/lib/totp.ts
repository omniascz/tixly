// ---------------------------------------------------------------------------
// TOTP verification (RFC 6238) — browser Web Crypto API
// Ported from mobile-scanner/src/lib/totp.ts. HMAC-SHA1, step=30s, 8 digits,
// ±1 window tolerance to match the server implementation.
// ---------------------------------------------------------------------------

const STEP_SECONDS = 30;
const DIGITS = 8;
const WINDOW = 1;

function totpEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function getCounter(timestampSec: number): bigint {
  return BigInt(Math.floor(timestampSec / STEP_SECONDS));
}

function counterToBytes(counter: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  return buf;
}

function truncate(digest: Uint8Array): number {
  const offset = digest[digest.length - 1] & 0x0f;
  const binCode =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return binCode % 10 ** DIGITS;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function secretToBytes(secret: string): Uint8Array {
  // Accept hex secrets; otherwise UTF-8 encode.
  if (/^[0-9a-fA-F]+$/.test(secret) && secret.length % 2 === 0) {
    return hexToBytes(secret);
  }
  return new TextEncoder().encode(secret);
}

async function importKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
}

async function hmacSha1(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return new Uint8Array(sig);
}

/**
 * Generates an 8-digit TOTP for the given secret and timestamp (ms).
 */
export async function generateTotpCode(
  secret: string | Uint8Array,
  timestamp: number = Date.now()
): Promise<string> {
  const secretBytes = typeof secret === 'string' ? secretToBytes(secret) : secret;
  const counter = getCounter(Math.floor(timestamp / 1000));
  const key = await importKey(secretBytes);
  const digest = await hmacSha1(key, counterToBytes(counter));
  return truncate(digest).toString().padStart(DIGITS, '0');
}

/**
 * Verifies a TOTP code against the secret, allowing ±1 window tolerance.
 */
export async function verifyTotpCode(
  secret: string,
  code: string,
  timestamp: number = Date.now()
): Promise<boolean> {
  if (!/^\d{8}$/.test(code)) return false;
  const secretBytes = secretToBytes(secret);
  const key = await importKey(secretBytes);
  const nowSec = Math.floor(timestamp / 1000);

  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    const counter = getCounter(nowSec) + BigInt(delta);
    const digest = await hmacSha1(key, counterToBytes(counter));
    const candidate = truncate(digest).toString().padStart(DIGITS, '0');
    if (totpEqual(candidate, code)) return true;
  }
  return false;
}
