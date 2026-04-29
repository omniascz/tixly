// ---------------------------------------------------------------------------
// QR Payload encode / decode / verify
// Ported from totp-qr/src/lib/qr-payload.ts — replaced Node.js crypto with
// Web Crypto API (crypto.subtle) for React Native compatibility.
// ---------------------------------------------------------------------------

export interface QRPayload {
  ticketId: string;
  totpValue: string;
  timestamp: number;
  eventId: string;
  signature: string;
}

/**
 * Builds the canonical pipe-delimited message string for HMAC signing.
 * Field order must remain stable — any change breaks existing signatures.
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
 * Converts a hex string to a Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Converts a Uint8Array to a lowercase hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Encodes a UTF-8 string to base64 without Node.js Buffer.
 * Uses TextEncoder + btoa on the binary representation.
 */
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a base64 string to a UTF-8 string without Node.js Buffer.
 */
function fromBase64(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Computes HMAC-SHA256 over `message` using `secret`.
 * Returns the hex-encoded digest.
 */
async function computeHMAC(message: string, secret: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const msgBytes = new TextEncoder().encode(message);
  const sigBuf = await crypto.subtle.sign("HMAC", key, msgBytes);
  return bytesToHex(new Uint8Array(sigBuf));
}

/**
 * Encodes a QR payload as BASE64(ticketId|totpValue|timestamp|eventId|hmac).
 * The timestamp is the current unix second.
 */
export async function encodeQRPayload(
  ticketId: string,
  totpValue: string,
  eventId: string,
  secret: Uint8Array
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = buildMessage(ticketId, totpValue, timestamp, eventId);
  const signature = await computeHMAC(message, secret);
  const raw = `${message}|${signature}`;
  return toBase64(raw);
}

/**
 * Decodes a BASE64-encoded QR payload string back into a QRPayload object.
 * Throws if the encoded string is malformed.
 */
export function decodeQRPayload(encoded: string): QRPayload {
  let raw: string;
  try {
    raw = fromBase64(encoded);
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
 * Returns false for any mismatch — never throws on bad input.
 */
export async function verifyQRPayload(
  payload: QRPayload,
  secret: Uint8Array
): Promise<boolean> {
  try {
    const message = buildMessage(
      payload.ticketId,
      payload.totpValue,
      payload.timestamp,
      payload.eventId
    );
    const expected = await computeHMAC(message, secret);
    return timingSafeEqual(expected, payload.signature);
  } catch {
    return false;
  }
}

/**
 * Constant-time hex-string comparison to avoid timing side-channels.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
