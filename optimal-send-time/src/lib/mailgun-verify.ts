/**
 * Mailgun webhook signature verification
 *
 * Mailgun signs every webhook request with HMAC-SHA256:
 *
 *   signature = HMAC-SHA256(timestamp + token, webhookKey)
 *
 * Both timestamp and token are sent in the request body.
 * We verify:
 *   1. HMAC digest matches
 *   2. timestamp is recent (replay-attack guard)
 *
 * Reference: https://documentation.mailgun.com/en/latest/user_manual.html#webhooks
 */

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify the Mailgun webhook HMAC-SHA256 signature.
 *
 * @param timestamp   The `timestamp` field from the Mailgun signature object.
 * @param token       The `token` field from the Mailgun signature object.
 * @param signature   The `signature` field from the Mailgun signature object.
 * @param webhookKey  Your Mailgun webhook signing key (MAILGUN_WEBHOOK_KEY env var).
 * @returns           true if the signature is valid, false otherwise.
 */
export function verifyMailgunSignature(
  timestamp: string,
  token: string,
  signature: string,
  webhookKey: string
): boolean {
  if (!timestamp || !token || !signature || !webhookKey) {
    return false;
  }

  // Mailgun spec: HMAC-SHA256(timestamp + token, key) → hex
  const digest = createHmac('sha256', webhookKey)
    .update(timestamp + token)
    .digest('hex');

  // Use timing-safe comparison to prevent timing side-channels
  try {
    const digestBuf    = Buffer.from(digest,    'hex');
    const signatureBuf = Buffer.from(signature, 'hex');

    if (digestBuf.length !== signatureBuf.length) {
      return false;
    }

    return timingSafeEqual(digestBuf, signatureBuf);
  } catch {
    return false;
  }
}

/**
 * Confirm that a Mailgun webhook timestamp is within the allowed age.
 *
 * Mailgun timestamps are Unix epoch seconds (integer strings).
 * We compare against the current time to detect stale/replayed requests.
 *
 * @param timestamp      The `timestamp` field as received from Mailgun.
 * @param maxAgeSeconds  Maximum allowed age in seconds (e.g. 900 = 15 min).
 * @returns              true if the timestamp is fresh, false if stale or invalid.
 */
export function isTimestampFresh(
  timestamp: string,
  maxAgeSeconds: number
): boolean {
  const ts = parseInt(timestamp, 10);

  if (isNaN(ts) || ts <= 0) {
    return false;
  }

  const nowSeconds  = Math.floor(Date.now() / 1000);
  const ageSeconds  = nowSeconds - ts;

  // Also reject timestamps in the future (> 60 s tolerance for clock skew)
  if (ageSeconds < -60) {
    return false;
  }

  return ageSeconds <= maxAgeSeconds;
}
