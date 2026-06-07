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
 *  Pro provozně tvrdší řešení by se měla pre-loadovat whitelist platných
 *  ticket IDs před začátkem představení a validovat proti ní (TODO).
 */

const DB_NAME = 'tixly-scanner';
const DB_VERSION = 1;
const STORE_NAME = 'pending-scans';

export interface ScanPayload {
  /** Holý ticket UUID (mobilní/manuální sken). Vzájemně výlučné s printToken. */
  ticketId?: string;
  /** Podepsaný token z tištěné vstupenky (104mm label). */
  printToken?: string;
  totpCode?: string;
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
