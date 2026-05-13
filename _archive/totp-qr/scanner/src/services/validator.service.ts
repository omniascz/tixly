import { decodeQRPayload, verifyQRPayload } from "../../../src/lib/qr-payload";
import { verifyTOTP } from "../../../src/lib/totp";
import { decryptSecret } from "../../../src/services/totp-encryption.service";
import {
  getTicket,
  markAsScanned,
  recordScannedToken,
} from "../db/offline-cache";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  success: boolean;
  ticketId: string;
  holderName: string;
  seatInfo: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Offline validator
// ---------------------------------------------------------------------------

/**
 * Validates a scanned QR code entirely offline against the local SQLite cache.
 *
 * Validation order:
 * 1. Decode base64 payload.
 * 2. Match eventId.
 * 3. Look up ticket in local cache.
 * 4. Check ticket status.
 * 5. Decrypt TOTP secret (uses TOTP_MASTER_KEY env var).
 * 6. Verify HMAC signature.
 * 7. Verify TOTP value (±1 window).
 * 8. Anti-replay: SQLite UNIQUE constraint on (ticket_id, totp_value).
 * 9. Mark ticket as scanned in local cache.
 */
export async function validateOffline(
  qrEncoded: string,
  eventId: string
): Promise<ValidationResult> {
  // --- Decode ---
  let payload;
  try {
    payload = decodeQRPayload(qrEncoded);
  } catch {
    return fail("", "Invalid QR code");
  }

  // --- Event check ---
  if (payload.eventId !== eventId) {
    return fail(payload.ticketId, "Wrong event");
  }

  // --- Expiry (90s = 3 TOTP windows) ---
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - payload.timestamp) > 90) {
    return fail(payload.ticketId, "QR code expired");
  }

  // --- Local ticket lookup ---
  const row = getTicket(payload.ticketId);
  if (!row) {
    return fail(payload.ticketId, "Ticket not found in local cache");
  }

  if (row.status === "revoked") {
    return fail(payload.ticketId, "Ticket revoked");
  }
  if (row.status === "used") {
    return fail(payload.ticketId, "Ticket already used");
  }

  // --- Decrypt secret ---
  let secret: Buffer;
  try {
    secret = await decryptSecret(
      row.totp_secret_encrypted,
      row.totp_secret_iv,
      payload.ticketId
    );
  } catch {
    return fail(payload.ticketId, "Secret decryption failed");
  }

  // --- Verify HMAC signature ---
  if (!verifyQRPayload(payload, secret)) {
    return fail(payload.ticketId, "Invalid signature");
  }

  // --- Verify TOTP ---
  const totpTimestampMs = payload.timestamp * 1000;
  if (!verifyTOTP(secret, payload.totpValue, totpTimestampMs)) {
    return fail(payload.ticketId, "Invalid TOTP code");
  }

  // --- Anti-replay: insert into scanned_tokens ---
  const isNew = recordScannedToken(payload.ticketId, payload.totpValue);
  if (!isNew) {
    return fail(payload.ticketId, "Already scanned (duplicate)");
  }

  // --- Mark as used in local cache ---
  markAsScanned(payload.ticketId, new Date());

  return {
    success: true,
    ticketId: row.ticket_id,
    holderName: row.holder_name,
    seatInfo: row.seat_info,
  };
}

function fail(ticketId: string, error: string): ValidationResult {
  return { success: false, ticketId, holderName: "", seatInfo: "", error };
}
