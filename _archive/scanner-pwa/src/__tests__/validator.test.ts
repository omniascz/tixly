// ---------------------------------------------------------------------------
// Validator tests — Vitest + fake-indexeddb
// ---------------------------------------------------------------------------
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  openCache,
  cacheTickets,
  recordScan,
  getCacheFacade,
  _resetCacheForTests,
  type TicketCacheRow,
} from '../lib/offline-cache.js';
import { validateScan } from '../lib/validator.js';
import { generateTotpCode } from '../lib/totp.js';

const SECRET_HEX = '3132333435363738393031323334353637383930'; // "12345678901234567890"
const EVENT_ID = 'evt_1';

async function makeQRPayload(
  ticketId: string,
  eventId: string,
  code: string,
  signature = 'sig'
): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const raw = `${ticketId}|${code}|${ts}|${eventId}|${signature}`;
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function baseTicket(overrides: Partial<TicketCacheRow> = {}): TicketCacheRow {
  return {
    ticketId: 't_1',
    eventId: EVENT_ID,
    holderName: 'Jan Novák',
    ticketType: 'standard',
    seatInfo: 'A12',
    status: 'valid',
    totpSecret: SECRET_HEX,
    lastSyncedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(async () => {
  // Wipe IndexedDB between tests
  // @ts-expect-error — provided by fake-indexeddb
  globalThis.indexedDB = new (await import('fake-indexeddb')).IDBFactory();
  _resetCacheForTests();
  await openCache();
});

describe('validateScan', () => {
  it('returns valid for a well-formed scan', async () => {
    await cacheTickets([baseTicket()]);
    const code = await generateTotpCode(SECRET_HEX);
    const qr = await makeQRPayload('t_1', EVENT_ID, code);
    const cache = await getCacheFacade();
    const r = await validateScan(qr, EVENT_ID, cache);
    expect(r.type).toBe('valid');
    if (r.type === 'valid') expect(r.holderName).toBe('Jan Novák');
  });

  it('returns invalid_signature for wrong TOTP code', async () => {
    await cacheTickets([baseTicket()]);
    const qr = await makeQRPayload('t_1', EVENT_ID, '00000000');
    const cache = await getCacheFacade();
    const r = await validateScan(qr, EVENT_ID, cache);
    expect(r.type).toBe('invalid_signature');
  });

  it('returns ticket_not_found when ticket is not cached', async () => {
    const code = await generateTotpCode(SECRET_HEX);
    const qr = await makeQRPayload('missing', EVENT_ID, code);
    const cache = await getCacheFacade();
    const r = await validateScan(qr, EVENT_ID, cache);
    expect(r.type).toBe('ticket_not_found');
  });

  it('returns wrong_event for mismatched event id', async () => {
    await cacheTickets([baseTicket({ eventId: 'evt_other' })]);
    const code = await generateTotpCode(SECRET_HEX);
    const qr = await makeQRPayload('t_1', EVENT_ID, code);
    const cache = await getCacheFacade();
    const r = await validateScan(qr, EVENT_ID, cache);
    expect(r.type).toBe('wrong_event');
  });

  it('returns ticket_refunded for refunded tickets', async () => {
    await cacheTickets([baseTicket({ status: 'refunded' })]);
    const code = await generateTotpCode(SECRET_HEX);
    const qr = await makeQRPayload('t_1', EVENT_ID, code);
    const cache = await getCacheFacade();
    const r = await validateScan(qr, EVENT_ID, cache);
    expect(r.type).toBe('ticket_refunded');
  });

  it('returns already_scanned on the second scan of the same ticket', async () => {
    await cacheTickets([baseTicket()]);
    await recordScan({
      ticketId: 't_1',
      scannedAt: Date.now() - 60_000,
      result: 'valid',
      offlineQueued: false,
    });
    const code = await generateTotpCode(SECRET_HEX);
    const qr = await makeQRPayload('t_1', EVENT_ID, code);
    const cache = await getCacheFacade();
    const r = await validateScan(qr, EVENT_ID, cache);
    expect(r.type).toBe('already_scanned');
  });
});
