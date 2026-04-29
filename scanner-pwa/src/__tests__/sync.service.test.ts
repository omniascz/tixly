// ---------------------------------------------------------------------------
// Sync service tests — Vitest with fetch mocking
// ---------------------------------------------------------------------------
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  openCache,
  _resetCacheForTests,
  getTicket,
  getPendingScans,
  type TicketCacheRow,
} from '../lib/offline-cache.js';
import {
  syncEventTickets,
  flushPendingScans,
  runSyncCycle,
} from '../lib/sync.service.js';

const TEST_EVENT_ID = 'evt_test';
const TEST_TOKEN = 'token_test';

const mockTickets: TicketCacheRow[] = [
  {
    ticketId: 't_1',
    eventId: TEST_EVENT_ID,
    holderName: 'Alice',
    ticketType: 'standard',
    seatInfo: 'A1',
    status: 'valid',
    totpSecret: 'deadbeef',
    lastSyncedAt: Date.now(),
  },
  {
    ticketId: 't_2',
    eventId: TEST_EVENT_ID,
    holderName: 'Bob',
    ticketType: 'vip',
    seatInfo: null,
    status: 'valid',
    totpSecret: 'cafebabe',
    lastSyncedAt: Date.now(),
  },
];

beforeEach(async () => {
  // @ts-expect-error — provided by fake-indexeddb
  globalThis.indexedDB = new (await import('fake-indexeddb')).IDBFactory();
  _resetCacheForTests();
  await openCache();

  // Mock fetch globally
  vi.stubGlobal('fetch', vi.fn());

  // Set API base
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3010';
});

describe('sync.service', () => {
  describe('syncEventTickets', () => {
    it('caches tickets from successful response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tickets: mockTickets,
          serverTime: Date.now(),
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await syncEventTickets(TEST_EVENT_ID, TEST_TOKEN);
      expect(result.cached).toBe(2);

      // Verify tickets are in cache
      const t1 = await getTicket('t_1');
      expect(t1?.holderName).toBe('Alice');
      const t2 = await getTicket('t_2');
      expect(t2?.holderName).toBe('Bob');

      // Verify fetch was called with correct headers
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/scanner/events/evt_test/tickets'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: `Bearer ${TEST_TOKEN}`,
          }),
        }),
      );
    });

    it('returns cached: 0 if network request fails', async () => {
      const mockFetch = vi.fn().mockResolvedValue(null);
      vi.stubGlobal('fetch', mockFetch);

      const result = await syncEventTickets(TEST_EVENT_ID, TEST_TOKEN);
      expect(result.cached).toBe(0);
    });

    it('returns cached: 0 if response is not ok', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await syncEventTickets(TEST_EVENT_ID, TEST_TOKEN);
      expect(result.cached).toBe(0);
    });

    it('returns cached: 0 if response JSON is invalid', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('JSON parse error');
        },
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await syncEventTickets(TEST_EVENT_ID, TEST_TOKEN);
      expect(result.cached).toBe(0);
    });
  });

  describe('flushPendingScans', () => {
    it('posts pending scans and marks them synced', async () => {
      // First, insert some pending scans
      const { recordScan, markScanSynced } = await import(
        '../lib/offline-cache.js'
      );
      const scanId1 = await recordScan({
        ticketId: 't_1',
        scannedAt: Date.now(),
        result: 'valid',
        offlineQueued: true,
      });
      const scanId2 = await recordScan({
        ticketId: 't_2',
        scannedAt: Date.now(),
        result: 'invalid',
        offlineQueued: true,
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ recorded: 2, duplicates: 0 }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await flushPendingScans(TEST_TOKEN);
      expect(result.synced).toBe(2);
      expect(result.failed).toBe(0);

      // Verify scans are no longer pending
      const pending = await getPendingScans();
      expect(pending.length).toBe(0);
    });

    it('returns synced: 0 if no pending scans exist', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const result = await flushPendingScans(TEST_TOKEN);
      expect(result.synced).toBe(0);
      expect(result.failed).toBe(0);

      // Fetch should not be called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns failed: N if network request fails', async () => {
      const { recordScan } = await import('../lib/offline-cache.js');
      await recordScan({
        ticketId: 't_1',
        scannedAt: Date.now(),
        result: 'valid',
        offlineQueued: true,
      });
      await recordScan({
        ticketId: 't_2',
        scannedAt: Date.now(),
        result: 'invalid',
        offlineQueued: true,
      });

      const mockFetch = vi.fn().mockResolvedValue(null);
      vi.stubGlobal('fetch', mockFetch);

      const result = await flushPendingScans(TEST_TOKEN);
      expect(result.synced).toBe(0);
      expect(result.failed).toBe(2);

      // Scans should still be pending
      const pending = await getPendingScans();
      expect(pending.length).toBe(2);
    });
  });

  describe('runSyncCycle', () => {
    it('runs full sync cycle: fetch tickets + flush pending scans', async () => {
      const { recordScan } = await import('../lib/offline-cache.js');
      const scanId = await recordScan({
        ticketId: 't_1',
        scannedAt: Date.now(),
        result: 'valid',
        offlineQueued: true,
      });

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          // First call: syncEventTickets
          ok: true,
          json: async () => ({
            tickets: mockTickets,
            serverTime: Date.now(),
          }),
        })
        .mockResolvedValueOnce({
          // Second call: flushPendingScans
          ok: true,
          json: async () => ({ recorded: 1, duplicates: 0 }),
        });

      vi.stubGlobal('fetch', mockFetch);

      const result = await runSyncCycle(TEST_EVENT_ID, TEST_TOKEN);
      expect(result.cached).toBe(2);
      expect(result.synced).toBe(1);

      // Verify two fetch calls
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
