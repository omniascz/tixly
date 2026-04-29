/**
 * Minimal TOTP verify (RFC 6238 / RFC 4226 HOTP).
 *
 * Záměrně bez externí závislosti (otplib v13 má plugin-based API, které
 * vyžaduje další setup). Tady jen čisté Node `crypto` HMAC-SHA1.
 *
 *   - 6-digit codes
 *   - 30s step
 *   - window: ±1 step (povolí code z aktuální nebo sousední 30s slotu)
 *   - SHA-1 (per RFC default)
 */

import { createHmac } from 'crypto';

const STEP_SECONDS = 30;
const DIGITS = 6;
const DEFAULT_WINDOW = 1;

function generateCode(secretRaw: Buffer, counter: bigint): string {
  // Counter → 8-byte big-endian buffer
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(counter);

  const hmac = createHmac('sha1', secretRaw).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function generateTotpCode(
  secretRaw: Buffer,
  atDate: Date = new Date(),
): string {
  const counter = BigInt(Math.floor(atDate.getTime() / 1000 / STEP_SECONDS));
  return generateCode(secretRaw, counter);
}

export function verifyTotpCode(
  candidate: string,
  secretRaw: Buffer,
  options: { window?: number; atDate?: Date } = {},
): boolean {
  if (!/^\d{6}$/.test(candidate)) return false;
  const atDate = options.atDate ?? new Date();
  const window = options.window ?? DEFAULT_WINDOW;
  const baseCounter = BigInt(Math.floor(atDate.getTime() / 1000 / STEP_SECONDS));

  for (let offset = -window; offset <= window; offset++) {
    const counter = baseCounter + BigInt(offset);
    if (counter < 0n) continue;
    if (generateCode(secretRaw, counter) === candidate) return true;
  }
  return false;
}
