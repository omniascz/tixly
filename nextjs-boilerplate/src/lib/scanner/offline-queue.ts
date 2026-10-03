/**
 * Scanner offline queue (IndexedDB)
 *
 * Když u dveří spadne Wi-Fi, scanner přepne do offline modu:
 *   1. handleSubmit() volá enqueueScan() místo POST /api/admin/scanner/validate
 *   2. UI zobrazí "Přijato (offline)" + počítadlo pending scanů
 *   3. Při návratu online (navigator.online event nebo manuální Sync)
 *      flushQueue() pošle všechny pending na server v pořadí enqueuedAt
 *
 * **Bezpečnost:** offline mód = optimistic accept. Server může později
 *  zjistit, že byl naskenován neplatný/použitý lístek — v takovém případě
 *  záznam zůstává v queue s `serverResult: 'already_used'` apod. pro audit.
 *
 *  TVRDŠÍ OFFLINE (v2): scanner si přes `saveManifest()` předstáhne whitelist
 *  platných ticket UUID pro akci a offline ověřuje sken proti němu
 *  (`validateOffline()`) + drží lokální evidenci už použitých (anti dvojí-vstup).
 *  Padělaný/cizí lístek se tak offline odmítne, ne slepě pustí.
 */

const DB_NAME = 'tixly-scanner';
const DB_VERSION = 2;
const STORE_NAME = 'pending-scans';
/** Whitelist platných ticket UUID per akce: keyPath 'eventId'. */
const MANIFEST_STORE = 'manifest';
/** Offline použité ticket UUID (anti dvojí-vstup bez sítě): keyPath 'key' = `${eventId}:${ticketId}`. */
const REDEEMED_STORE = 'offline-redeemed';

export interface ScanPayload {
  /** Holý ticket UUID (mobilní/manuální sken). Vzájemně výlučné s printToken. */
  ticketId?: string;
  /** Podepsaný token z tištěné vstupenky (104mm label). */
  printToken?: string;
  totpCode?: string;
  /** Kolo 3 (V9b): akce brány — server odmítne lístek jiné akce (wrong_event). */
  eventId?: string;
  eventDayId?: string;
  zoneId?: string;
}

export interface QueuedScan {
  id: number; // auto-increment
  payload: ScanPayload;
  enqueuedAt: number; // Date.now()
  gateLabel: string; // pro audit: "Hlavní sál · vstup 1"
  serverResult?: string; // až bude flushnuto, sem se uloží result
  syncedAt?: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB not available (SSR)'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(MANIFEST_STORE)) {
          db.createObjectStore(MANIFEST_STORE, { keyPath: 'eventId' });
        }
        if (!db.objectStoreNames.contains(REDEEMED_STORE)) {
          db.createObjectStore(REDEEMED_STORE, { keyPath: 'key' });
        }
      };
    });
  }
  return dbPromise;
}

export async function enqueueScan(
  payload: ScanPayload,
  gateLabel: string,
): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.add({
      payload,
      enqueuedAt: Date.now(),
      gateLabel,
    });
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingScans(): Promise<QueuedScan[]> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as QueuedScan[])
          .filter((s) => !s.syncedAt)
          .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
        resolve(all);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function getPendingCount(): Promise<number> {
  const all = await getPendingScans();
  return all.length;
}

export async function markSynced(id: number, serverResult: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result as QueuedScan | undefined;
      if (!record) {
        resolve();
        return;
      }
      record.serverResult = serverResult;
      record.syncedAt = Date.now();
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function deleteScan(id: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export interface FlushResult {
  attempted: number;
  synced: number;
  failed: number;
  conflicts: { ticketId: string; result: string }[];
}

/**
 * Pošli všechny pending scany na server v pořadí enqueuedAt.
 * Volá `POST /api/admin/scanner/validate` pro každý.
 */
export async function flushQueue(authToken: string | null): Promise<FlushResult> {
  const pending = await getPendingScans();
  const out: FlushResult = { attempted: pending.length, synced: 0, failed: 0, conflicts: [] };

  for (const scan of pending) {
    try {
      const res = await fetch('/api/admin/scanner/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(scan.payload),
      });
      if (!res.ok && res.status >= 500) {
        // Server error — necháme v queue, zkusíme příště
        out.failed += 1;
        continue;
      }
      const data = (await res.json().catch(() => ({}))) as { result?: string };
      const result = data.result ?? 'error';
      await markSynced(scan.id, result);
      out.synced += 1;
      // Pokud lístek byl already_used / not_found / wrong_promoter → byl falešný
      if (result !== 'admitted') {
        out.conflicts.push({
          ticketId: scan.payload.ticketId ?? scan.payload.printToken ?? '?',
          result,
        });
      }
    } catch {
      // síťová chyba — necháme v queue
      out.failed += 1;
    }
  }
  return out;
}

export async function clearSynced(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const records = req.result as QueuedScan[];
      for (const r of records) {
        if (r.syncedAt) store.delete(r.id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

// ── Offline whitelist (v2) ───────────────────────────────────────────────────

interface ManifestRecord {
  eventId: string;
  ticketIds: string[];
  generatedAt: string;
  savedAt: number;
}

export interface ManifestMeta {
  count: number;
  generatedAt: string;
  savedAt: number;
}

/** Uloží whitelist platných ticket UUID pro akci (stáhnuto z /scanner/manifest). */
export async function saveManifest(
  eventId: string,
  ticketIds: string[],
  generatedAt: string,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MANIFEST_STORE, 'readwrite');
    const rec: ManifestRecord = {
      eventId,
      ticketIds: ticketIds.map((t) => t.toLowerCase()),
      generatedAt,
      savedAt: Date.now(),
    };
    const req = tx.objectStore(MANIFEST_STORE).put(rec);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getManifest(eventId: string): Promise<ManifestRecord | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(MANIFEST_STORE, 'readonly');
      const req = tx.objectStore(MANIFEST_STORE).get(eventId);
      req.onsuccess = () => resolve((req.result as ManifestRecord) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getManifestMeta(eventId: string): Promise<ManifestMeta | null> {
  const m = await getManifest(eventId);
  if (!m) return null;
  return { count: m.ticketIds.length, generatedAt: m.generatedAt, savedAt: m.savedAt };
}

export type OfflineCheck =
  | 'admitted'
  | 'not_found'
  | 'already_used'
  | 'no_manifest'; // žádný stažený whitelist → caller padá na optimistic

/**
 * Offline ověření skenu proti staženému whitelistu + lokální evidenci použití.
 * Při 'admitted' rovnou označí lístek jako lokálně použitý (anti dvojí-vstup).
 * Vrací 'no_manifest', pokud pro akci není whitelist (caller pak může optimistic).
 */
export async function validateOffline(eventId: string, ticketId: string): Promise<OfflineCheck> {
  const id = ticketId.toLowerCase();
  const manifest = await getManifest(eventId);
  if (!manifest) return 'no_manifest';
  if (!manifest.ticketIds.includes(id)) return 'not_found';

  const db = await openDb();
  const key = `${eventId}:${id}`;
  // Atomicky: pokud už lokálně použit → already_used, jinak označit a admit.
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(REDEEMED_STORE, 'readwrite');
    const store = tx.objectStore(REDEEMED_STORE);
    const getReq = store.get(key);
    getReq.onsuccess = () => {
      if (getReq.result) {
        resolve('already_used');
        return;
      }
      store.put({ key, redeemedAt: Date.now() });
      tx.oncomplete = () => resolve('admitted');
    };
    getReq.onerror = () => reject(getReq.error);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Klientský (bez secretu) dekodér ticket UUID z tištěného print tokenu
 * `TXP1.<b64url(uuid16+hmac10)>`. HMAC se offline neověřuje — anti-forgery
 * zajišťuje členství ve whitelistu. Vrací UUID nebo null, když to není print token.
 */
export function decodePrintTokenUuid(raw: string): string | null {
  const trimmed = raw.trim();
  // TXP1 i TXP2 (kolo 4) mají na začátku 16 bajtů UUID vstupenky, liší se jen podpisem.
  const scheme = /^TXP[12]\./.exec(trimmed)?.[0];
  if (!scheme) return null;
  try {
    const body = trimmed.slice(scheme.length);
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (body.length % 4)) % 4);
    const bin = atob(b64);
    if (bin.length < 16) return null;
    let hex = '';
    for (let i = 0; i < 16; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  } catch {
    return null;
  }
}
