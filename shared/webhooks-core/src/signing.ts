/**
 * HMAC-SHA256 webhook signing & verification.
 *
 * Shared across Accounting, Tixly, and Mailforge.
 * Format: "sha256=<64-char-hex>" (GitHub/Stripe compatible).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Sign a payload string with HMAC-SHA256.
 * @returns Signature in format "sha256=<hex>"
 */
export function signPayload(secret: string, payload: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Verify a webhook signature using timing-safe comparison.
 * Prevents timing attacks by comparing all bytes regardless of mismatch position.
 */
export function verifySignature(
  secret: string,
  payload: string,
  signature: string,
): boolean {
  try {
    const expected = signPayload(secret, payload);
    if (expected.length !== signature.length) return false;
    return timingSafeEqual(
      Buffer.from(expected, 'utf-8'),
      Buffer.from(signature, 'utf-8'),
    );
  } catch {
    return false;
  }
}

/**
 * Sign payload with timestamp for replay attack prevention.
 * Format: "t=<unix-timestamp>,v1=<hex>"
 * Signed data: "<timestamp>.<payload>"
 */
export function signPayloadWithTimestamp(
  secret: string,
  payload: string,
  timestamp: number,
): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(`${timestamp}.${payload}`);
  return `t=${timestamp},v1=${hmac.digest('hex')}`;
}

/**
 * Verify a timestamped signature with tolerance window.
 * Prevents replay attacks by rejecting signatures older than toleranceSec.
 */
export function verifyTimestampedSignature(
  secret: string,
  payload: string,
  header: string,
  toleranceSec: number = 300,
): boolean {
  try {
    const tMatch = header.match(/t=(\d+)/);
    const vMatch = header.match(/v1=([0-9a-f]+)/);
    if (!tMatch?.[1] || !vMatch?.[1]) return false;

    const timestamp = parseInt(tMatch[1], 10);
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestamp) > toleranceSec) return false;

    const expectedHmac = createHmac('sha256', secret);
    expectedHmac.update(`${timestamp}.${payload}`);
    const expectedHex = expectedHmac.digest('hex');

    if (expectedHex.length !== vMatch[1].length) return false;
    return timingSafeEqual(
      Buffer.from(expectedHex, 'utf-8'),
      Buffer.from(vMatch[1], 'utf-8'),
    );
  } catch {
    return false;
  }
}

/**
 * Generate a cryptographically secure webhook secret.
 * @returns 64-character hex string (32 random bytes)
 */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}
