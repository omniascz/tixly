// ---------------------------------------------------------------------------
// IndexedDB-backed offline cache for the scanner PWA.
// Mirrors the mobile-scanner SQLite cache, adapted for the browser via `idb`.
// ---------------------------------------------------------------------------
import { openDB, type IDBPDatabase, type DBSchema } from 'idb';

export interface TicketCacheRow {
  ticketId: string;
  eventId: string;
  holderName: string;
  ticketType: string;
  seatInfo: string | null;
  status: 'valid' | 'used' | 'refunded' | 'cancelled' | 'revoked';
  totpSecret: string; // plaintext for offline TOTP verification
  lastSyncedAt: number;
}

export type ScanResultType =
  | 'valid'
  | 'invalid'
  | 'already_scanned';

export interface ScanRecord {
  scanId?: number;
  ticketId: string;
  scannedAt: number;
  result: ScanResultType;
  offlineQueued: boolean;
}

interface ScannerDB extends DBSchema {
  tickets: {
    key: string;
    value: TicketCacheRow;
    indexes: { 'by-event': string };
  };
  scans: {
    key: number;
    value: ScanRecord;
    indexes: { 'by-ticket': string; 'by-queued': number };
  };
  metadata: {
    key: string;
    value: { key: string; value: string };
  };
}

export interface IDBCache {
  db: IDBPDatabase<ScannerDB>;
  getTicket(ticketId: string): Promise<TicketCacheRow | undefined>;
  getScansForTicket(ticketId: string): Promise<ScanRecord[]>;
}

const DB_NAME = 'scanner-pwa';
const DB_VERSION = 1;

let _dbPromise: Promise<IDBPDatabase<ScannerDB>> | null = null;

export function openCache(): Promise<IDBPDatabase<ScannerDB>> {
  if (!_dbPromise) {
    _dbPromise = openDB<ScannerDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const tickets = db.createObjectStore('tickets', { keyPath: 'ticketId' });
        tickets.createIndex('by-event', 'eventId');

        const scans = db.createObjectStore('scans', {
          keyPath: 'scanId',
          autoIncrement: true,
        });
        scans.createIndex('by-ticket', 'ticketId');
        // IndexedDB cannot index boolean values reliably; store 0/1 via offlineQueued numeric shadow
        scans.createIndex('by-queued', 'offlineQueued');

        db.createObjectStore('metadata', { keyPath: 'key' });
      },
    });
  }
  return _dbPromise;
}

/** Resets the cached DB handle — primarily for tests. */
export function _resetCacheForTests(): void {
  _dbPromise = null;
}

export async function cacheTickets(tickets: TicketCacheRow[]): Promise<void> {
  const db = await openCache();
  const tx = db.transaction('tickets', 'readwrite');
  await Promise.all(tickets.map((t) => tx.store.put(t)));
  await tx.done;
}

export async function getTicket(
  ticketId: string
): Promise<TicketCacheRow | undefined> {
  const db = await openCache();
  return db.get('tickets', ticketId);
}

export async function recordScan(scan: ScanRecord): Promise<number> {
  const db = await openCache();
  const id = await db.add('scans', scan);
  return id as number;
}

export async function getScansForTicket(
  ticketId: string
): Promise<ScanRecord[]> {
  const db = await openCache();
  return db.getAllFromIndex('scans', 'by-ticket', ticketId);
}

export async function getPendingScans(): Promise<ScanRecord[]> {
  const db = await openCache();
  const all = await db.getAll('scans');
  return all.filter((s) => s.offlineQueued === true);
}

export async function markScanSynced(scanId: number): Promise<void> {
  const db = await openCache();
  const existing = await db.get('scans', scanId);
  if (!existing) return;
  existing.offlineQueued = false;
  await db.put('scans', existing);
}

const LAST_SYNC_KEY = 'lastSyncAt';

export async function getLastSyncAt(): Promise<number> {
  const db = await openCache();
  const row = await db.get('metadata', LAST_SYNC_KEY);
  return row ? Number(row.value) : 0;
}

export async function setLastSyncAt(ts: number): Promise<void> {
  const db = await openCache();
  await db.put('metadata', { key: LAST_SYNC_KEY, value: String(ts) });
}

/** Returns a bundled cache facade with helper methods for validator use. */
export async function getCacheFacade(): Promise<IDBCache> {
  const db = await openCache();
  return {
    db,
    getTicket: (id) => db.get('tickets', id),
    getScansForTicket: (id) => db.getAllFromIndex('scans', 'by-ticket', id),
  };
}
