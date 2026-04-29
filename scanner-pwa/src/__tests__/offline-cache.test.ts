// ---------------------------------------------------------------------------
// Offline cache tests — Vitest + fake-indexeddb
// ---------------------------------------------------------------------------
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  openCache,
  cacheTickets,
  getTicket,
  recordScan,
  markScanSynced,
  getPendingScans,
  _resetCacheForTests,
  type TicketCacheRow,
} from '../lib/offline-cache.js';

beforeEach(async () => {
  // @ts-expect-error — provided by fake-indexeddb
  globalThis.indexedDB = new (await import('fake-indexeddb')).IDBFactory();
  _resetCacheForTests();
  await openCache();
});

function ticket(id: string): TicketCacheRow {
  return {
    ticketId: id,
    eventId: 'evt',
    holderName: 'Test',
    ticketType: 'standard',
    seatInfo: null,
    status: 'valid',
    totpSecret: 'deadbeef',
    lastSyncedAt: Date.now(),
  };
}

describe('offline-cache', () => {
  it('caches tickets and reads them back', async () => {
    await cacheTickets([ticket('a'), ticket('b')]);
    const a = await getTicket('a');
    const b = await getTicket('b');
    expect(a?.ticketId).toBe('a');
    expect(b?.ticketId).toBe('b');
  });

  it('records a scan and marks it synced', async () => {
    const id = await recordScan({
      ticketId: 'a',
      scannedAt: Date.now(),
      result: 'valid',
      offlineQueued: true,
    });
    let pending = await getPendingScans();
    expect(pending.length).toBe(1);

    await markScanSynced(id);
    pending = await getPendingScans();
    expect(pending.length).toBe(0);
  });

  it('getPendingScans returns only non-synced scans', async () => {
    await recordScan({ ticketId: 'a', scannedAt: 1, result: 'valid', offlineQueued: true });
    await recordScan({ ticketId: 'b', scannedAt: 2, result: 'valid', offlineQueued: false });
    await recordScan({ ticketId: 'c', scannedAt: 3, result: 'invalid', offlineQueued: true });
    const pending = await getPendingScans();
    expect(pending.length).toBe(2);
    expect(pending.map((s) => s.ticketId).sort()).toEqual(['a', 'c']);
  });
});
