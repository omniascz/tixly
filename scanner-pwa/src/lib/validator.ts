// ---------------------------------------------------------------------------
// Pure scan validator — operates on the IndexedDB cache.
// Mirrors mobile-scanner/src/services/validator.service.ts.
// ---------------------------------------------------------------------------
import { decodeQRPayload } from './qr-payload.js';
import { verifyTotpCode } from './totp.js';
import type { IDBCache } from './offline-cache.js';

export type ScanResult =
  | { type: 'valid'; ticketId: string; holderName: string; seatInfo: string | null }
  | { type: 'invalid_signature' }
  | { type: 'ticket_not_found' }
  | { type: 'already_scanned'; previouslyScannedAt: string }
  | { type: 'wrong_event' }
  | { type: 'ticket_refunded' };

export async function validateScan(
  qrPayload: string,
  expectedEventId: string,
  cache: IDBCache
): Promise<ScanResult> {
  // 1. Parse payload
  let payload;
  try {
    payload = decodeQRPayload(qrPayload);
  } catch {
    return { type: 'invalid_signature' };
  }

  // 2. Lookup ticket
  const ticket = await cache.getTicket(payload.ticketId);
  if (!ticket) {
    return { type: 'ticket_not_found' };
  }

  // 3. Event match
  if (ticket.eventId !== expectedEventId) {
    return { type: 'wrong_event' };
  }

  // 4. Status
  if (ticket.status === 'refunded' || ticket.status === 'cancelled') {
    return { type: 'ticket_refunded' };
  }

  // 5. Verify TOTP code
  const totpOk = await verifyTotpCode(ticket.totpSecret, payload.totpValue);
  if (!totpOk) {
    return { type: 'invalid_signature' };
  }

  // 6. Multi-scan detection
  const prior = await cache.getScansForTicket(payload.ticketId);
  const priorValid = prior.find((s) => s.result === 'valid');
  if (priorValid) {
    return {
      type: 'already_scanned',
      previouslyScannedAt: new Date(priorValid.scannedAt).toISOString(),
    };
  }

  return {
    type: 'valid',
    ticketId: ticket.ticketId,
    holderName: ticket.holderName,
    seatInfo: ticket.seatInfo,
  };
}
