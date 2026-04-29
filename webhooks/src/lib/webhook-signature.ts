/**
 * Tixly-specific wrappers around @shared/webhooks signing functions.
 * Maintains the original argument order for backward compatibility.
 */
import {
  signPayload as sharedSign,
  verifySignature as sharedVerify,
  generateWebhookSecret,
} from '@shared/webhooks';

// Re-export secret generation directly
export { generateWebhookSecret };

// ---------------------------------------------------------------------------
// Webhook payload type (Tixly envelope format)
// ---------------------------------------------------------------------------

export interface WebhookPayload {
  id: string;
  type: string;
  created_at: string;
  data: unknown;
}

// ---------------------------------------------------------------------------
// Signature helpers (thin wrappers — arg order differs from shared)
// ---------------------------------------------------------------------------

/**
 * Generate HMAC-SHA256 signature for the given payload string using the secret.
 * Returns hex digest prefixed with "sha256=".
 */
export function generateSignature(payload: string, secret: string): string {
  return sharedSign(secret, payload);
}

/**
 * Verify a signature using timing-safe comparison.
 * Returns true if the signature is valid.
 */
export function verifySignature(payload: string, secret: string, signature: string): boolean {
  return sharedVerify(secret, payload, signature);
}

/**
 * Build a standard webhook payload envelope (Tixly format).
 */
export function buildPayload(eventType: string, eventId: string, data: unknown): WebhookPayload {
  return {
    id: eventId,
    type: eventType,
    created_at: new Date().toISOString(),
    data,
  };
}
