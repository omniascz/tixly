import { createHmac } from "crypto";

export interface QRPayload {
  ticketId: string;
  totpValue: string;
  timestamp: number;
  eventId: string;
  signature: string;
}

/**
 * Builds the canonical message string used for HMAC signing.
 * Order must stay stable — any change breaks existing signatures.
 */
function buildMessage(
  ticketId: string,
  totpValue: string,
  timestamp: number,
  eventId: string
): string {
  return `${ticketId}|${totpValue}|${timestamp}|${eventId}`;
}

/**
 * Computes HMAC-SHA256 over the pipe-delimited payload fields.
 * Returns the hex-encoded digest.
 */
function computeHMAC(message: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

/**
 * Encodes a QR payload as BASE64(ticketId|totpValue|timestamp|eventId|hmac).
 * The timestamp recorded is the current unix second.
 */
export function encodeQRPayload(
  ticketId: string,
  totpValue: string,
  eventId: string,
  secret: Buffer
): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = buildMessage(ticketId, totpValue, timestamp, eventId);
  const signature = computeHMAC(message, secret);
  const raw = `${message}|${signature}`;
  return Buffer.from(raw, "utf8").toString("base64");
}

/**
 * Decodes a BASE64-encoded QR payload string back into a QRPayload object.
 * Throws if the encoded string is malformed.
 */
export function decodeQRPayload(encoded: string): QRPayload {
  let raw: string;
  try {
    raw = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    throw new Error("QR_PAYLOAD_DECODE_FAILED: invalid base64");
  }

  const parts = raw.split("|");
  if (parts.length !== 5) {
    throw new Error(
      `QR_PAYLOAD_DECODE_FAILED: expected 5 fields, got ${parts.length}`
    );
  }

  const [ticketId, totpValue, timestampRaw, eventId, signature] = parts;
  const timestamp = Number(timestampRaw);

  if (!ticketId || !totpValue || !eventId || !signature) {
    throw new Error("QR_PAYLOAD_DECODE_FAILED: empty field(s)");
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error("QR_PAYLOAD_DECODE_FAILED: invalid timestamp");
  }

  return { ticketId, totpValue, timestamp, eventId, signature };
}

/**
 * Verifies the HMAC signature on a decoded QRPayload.
 * Returns false for any mismatch or decode error — never throws on bad input.
 */
export function verifyQRPayload(payload: QRPayload, secret: Buffer): boolean {
  const message = buildMessage(
    payload.ticketId,
    payload.totpValue,
    payload.timestamp,
    payload.eventId
  );
  const expected = computeHMAC(message, secret);
  // Constant-time comparison to avoid timing side-channels
  return timingSafeEqual(expected, payload.signature);
}

/**
 * Hex-string constant-time equality check.
 * Both strings must be the same length (SHA-256 hex is always 64 chars).
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
