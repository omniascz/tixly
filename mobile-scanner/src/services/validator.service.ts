// ---------------------------------------------------------------------------
// Offline ticket validator — React Native / Expo
// Ported from totp-qr/scanner/src/services/validator.service.ts
//
// Key changes vs. PWA version:
//  - decryptSecret is injectable (ValidatorDeps) for testability
//  - All TOTP/HMAC operations are async (Web Crypto API)
//  - Buffer replaced with Uint8Array throughout
// ---------------------------------------------------------------------------
import { decodeQRPayload, verifyQRPayload } from "../lib/qr-payload";
import { verifyTOTP } from "../lib/totp";
import {
  getTicket,
  markAsScanned,
  recordScannedToken,
} from "../db/offline-cache";
import type { ValidationResult } from "../types/scanner.types";
import { QR_MAX_AGE_SECONDS } from "../lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DecryptSecretFn = (
  encrypted: Uint8Array,
  iv: Uint8Array,
  ticketId: string
) => Promise<Uint8Array>;

export interface ValidatorDeps {
  decryptSecret?: DecryptSecretFn;
}

// ---------------------------------------------------------------------------
// Default decrypt implementation (uses expo-crypto AES-GCM via Web Crypto)
// ---------------------------------------------------------------------------

/**
 * Default AES-GCM decryption using the Web Crypto API.
 * The key is derived from an env-var TOTP_MASTER_KEY (hex-encoded 32 bytes).
 * Falls back to a no-op in environments where the env var is absent.
 */
const defaultDecryptSecret: DecryptSecretFn = async (
  encrypted: Uint8Array,
  iv: Uint8Array,
  _ticketId: string
): Promise<Uint8Array> => {
  const masterKeyHex = process.env.TOTP_MASTER_KEY ?? "";
  if (!masterKeyHex || masterKeyHex.length !== 64) {
    throw new Error("TOTP_MASTER_KEY not configured");
  }
  const masterKeyBytes = hexToBytes(masterKeyHex);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    masterKeyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encrypted
  );
  return new Uint8Array(plaintext);
};

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validates a scanned QR code entirely offline against the local SQLite cache.
 *
 * Validation order:
 * 1. Decode base64 payload.
 * 2. Match eventId.
 * 3. Check QR timestamp freshness (max 90 s).
 * 4. Look up ticket in local cache.
 * 5. Check ticket status (revoked / used).
 * 6. Decrypt TOTP secret via injected or default impl.
 * 7. Verify HMAC signature.
 * 8. Verify TOTP value (±1 window).
 * 9. Anti-replay: UNIQUE constraint on (ticket_id, totp_value).
 * 10. Mark ticket as scanned in local cache.
 */
export async function validateOffline(
  qrEncoded: string,
  eventId: string,
  deps: ValidatorDeps = {}
): Promise<ValidationResult> {
  const decrypt = deps.decryptSecret ?? defaultDecryptSecret;

  // --- 1. Decode ---
  let payload;
  try {
    payload = decodeQRPayload(qrEncoded);
  } catch {
    return fail("", "Invalid QR code");
  }

  // --- 2. Event check ---
  if (payload.eventId !== eventId) {
    return fail(payload.ticketId, "Wrong event");
  }

  // --- 3. Expiry ---
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - payload.timestamp) > QR_MAX_AGE_SECONDS) {
    return fail(payload.ticketId, "QR code expired");
  }

  // --- 4. Local ticket lookup ---
  const row = getTicket(payload.ticketId);
  if (!row) {
    return fail(payload.ticketId, "Ticket not found in local cache");
  }

  // --- 5. Status check ---
  if (row.status === "revoked") {
    return fail(payload.ticketId, "Ticket revoked");
  }
  if (row.status === "used") {
    return fail(payload.ticketId, "Ticket already used");
  }

  // --- 6. Decrypt secret ---
  let secret: Uint8Array;
  try {
    secret = await decrypt(
      row.totp_secret_encrypted,
      row.totp_secret_iv,
      payload.ticketId
    );
  } catch {
    return fail(payload.ticketId, "Secret decryption failed");
  }

  // --- 7. Verify HMAC signature ---
  const signatureOk = await verifyQRPayload(payload, secret);
  if (!signatureOk) {
    return fail(payload.ticketId, "Invalid signature");
  }

  // --- 8. Verify TOTP ---
  const totpTimestampMs = payload.timestamp * 1000;
  const totpOk = await verifyTOTP(secret, payload.totpValue, totpTimestampMs);
  if (!totpOk) {
    return fail(payload.ticketId, "Invalid TOTP code");
  }

  // --- 9. Anti-replay ---
  const isNew = recordScannedToken(payload.ticketId, payload.totpValue);
  if (!isNew) {
    return fail(payload.ticketId, "Already scanned");
  }

  // --- 10. Mark as used ---
  markAsScanned(payload.ticketId, new Date());

  return {
    success: true,
    ticketId: row.ticket_id,
    holderName: row.holder_name,
    seatInfo: row.seat_info,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(ticketId: string, error: string): ValidationResult {
  return { success: false, ticketId, holderName: "", seatInfo: "", error };
}
