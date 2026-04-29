// ---------------------------------------------------------------------------
// QR payload parser — ported from mobile-scanner/src/lib/qr-payload.ts
// Format: BASE64(ticketId|totpValue|timestamp|eventId|signature)
// ---------------------------------------------------------------------------
import { z } from 'zod';

export const QRPayloadSchema = z.object({
  ticketId: z.string().min(1),
  totpValue: z.string().regex(/^\d{8}$/),
  timestamp: z.number().int().positive(),
  eventId: z.string().min(1),
  signature: z.string().min(1),
});

export type QRPayload = z.infer<typeof QRPayloadSchema>;

function fromBase64(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Decodes a BASE64-encoded QR payload into a structured object.
 * Throws if malformed or if zod validation fails.
 */
export function decodeQRPayload(encoded: string): QRPayload {
  let raw: string;
  try {
    raw = fromBase64(encoded);
  } catch {
    throw new Error('QR_PAYLOAD_DECODE_FAILED: invalid base64');
  }

  const parts = raw.split('|');
  if (parts.length !== 5) {
    throw new Error(
      `QR_PAYLOAD_DECODE_FAILED: expected 5 fields, got ${parts.length}`
    );
  }

  const [ticketId, totpValue, timestampRaw, eventId, signature] = parts;
  const parsed = QRPayloadSchema.parse({
    ticketId,
    totpValue,
    timestamp: Number(timestampRaw),
    eventId,
    signature,
  });
  return parsed;
}
