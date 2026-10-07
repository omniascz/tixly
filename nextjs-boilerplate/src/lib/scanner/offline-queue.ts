/**
 * Scanner offline queue (IndexedDB)
 *
 * Když u dveří spadne Wi-Fi, scanner přepne do offline modu:
 *   1. handleSubmit() ověří sken proti staženému seznamu a uloží ho do fronty (enqueueScan)
 *   2. UI zobrazí výsledek + počítadlo pending scanů
 *   3. Při návratu online (navigator.online event nebo manuální Sync)
 *      flushQueue() pošle všechny pending na server v pořadí enqueuedAt
 *
 *  TVRDŠÍ OFFLINE (v2): scanner si přes `saveManifest()` předstáhne seznam vstupenek akce a offline ověřuje sken
 *  proti němu + drží lokální evidenci už použitých (anti dvojí-vstup). Padělaný/cizí lístek se offline odmítne.
 *
 *  KOLO 14 (C-50): seznam nese stav vstupenek (použitá / zrušená), kategorii s průkazem, otisky tiskových tokenů a
 *  časově omezené TOTP kódy — offline rozhodnutí = stejná pravidla jako online validate (`validateOfflineScan`).
 *  Každý offline sken má clientScanId a čas na zařízení; po obnovení sítě se odešlou na /scanner/offline-sync
 *  (idempotentně: opakované odeslání téhož skenu server nezapočítá dvakrát; druhé offline odbavení téže vstupenky
 *  jiným skenerem server zapíše jako 'duplicate').
 */
import { qrPolicyDecision } from '@/lib/scanner/qr-policy';

const DB_NAME = 'tixly-scanner';
const DB_VERSION = 2;
const STORE_NAME = 'pending-scans';
/** Offline seznam per akce: keyPath 'eventId'. */
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
  /** Kolo 14: idempotence synchronizace + verdikt zařízení */
  clientScanId?: string;
  offlineResult?: string;
  offlineReason?: string;
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

/** Kolo 14: trvalé ID tohoto zařízení (skeneru) pro audit scan_logs. */
export function scannerDeviceId(): string {
  const KEY = 'tixly.scanner.deviceId';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = `web-${crypto.randomUUID()}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'web-unknown';
  }
}

export async function enqueueScan(
  payload: ScanPayload,
  gateLabel: string,
  verdict?: { offlineResult: string; offlineReason?: string },
): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.add({
      payload,
      enqueuedAt: Date.now(),
      gateLabel,
      clientScanId: crypto.randomUUID(),
      offlineResult: verdict?.offlineResult ?? 'admitted',
      offlineReason: verdict?.offlineReason,
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

async function putScan(scan: QueuedScan): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(scan);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
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
 * Pošli všechny pending scany na server v pořadí enqueuedAt (kolo 14: /api/admin/scanner/offline-sync, po dávkách).
 * Idempotentní: každý sken má clientScanId — opakované odeslání (výpadek uprostřed) server nezapočítá znovu.
 */
export async function flushQueue(authToken: string | null): Promise<FlushResult> {
  const pending = await getPendingScans();
  const out: FlushResult = { attempted: pending.length, synced: 0, failed: 0, conflicts: [] };
  const deviceId = scannerDeviceId();

  for (let i = 0; i < pending.length; i += 50) {
    const batch = pending.slice(i, i + 50);
    for (const scan of batch) {
      if (!scan.clientScanId) {
        // záznam ze starší verze fronty — ID se přidělí a uloží, aby i jeho opakované odeslání bylo idempotentní
        scan.clientScanId = crypto.randomUUID();
        await putScan(scan);
      }
    }
    let results: Array<{ clientScanId: string; result: string }> = [];
    try {
      const res = await fetch('/api/admin/scanner/offline-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          deviceId,
          scans: batch.map((scan) => ({
            clientScanId: scan.clientScanId,
            ...(scan.payload.printToken ? { printToken: scan.payload.printToken } : { ticketId: scan.payload.ticketId }),
            ...(scan.payload.eventId ? { eventId: scan.payload.eventId } : {}),
            scannedAt: new Date(scan.enqueuedAt).toISOString(),
            offlineResult: scan.offlineResult ?? 'admitted',
            ...(scan.offlineReason ? { offlineReason: scan.offlineReason } : {}),
          })),
        }),
      });
      if (!res.ok) {
        // necháme v queue, zkusíme příště
        out.failed += batch.length;
        continue;
      }
      results = ((await res.json().catch(() => ({}))) as { results?: typeof results }).results ?? [];
    } catch {
      // síťová chyba — necháme v queue
      out.failed += batch.length;
      continue;
    }
    for (const scan of batch) {
      const r = results.find((x) => x.clientScanId === scan.clientScanId);
      if (!r || r.result === 'error') {
        out.failed += 1;
        continue;
      }
      await markSynced(scan.id, r.result);
      out.synced += 1;
      // zařízení pustilo, server ne (použitá jinde, mezitím zrušená…) → konflikt pro audit
      if ((scan.offlineResult ?? 'admitted') === 'admitted' && r.result !== 'admitted') {
        out.conflicts.push({ ticketId: scan.payload.ticketId ?? scan.payload.printToken ?? '?', result: r.result });
      }
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

// ── Offline seznam (v2, kolo 14) ─────────────────────────────────────────────

/** Kolo 14: vstupenka v offline seznamu (viz lib/scanner/offline-manifest — ManifestTicket). */
export interface OfflineManifestTicket {
  id: string;
  s: 'v' | 'u' | 'r';
  u?: string | null;
  tt?: string | null;
  c?: string | null;
  seat?: string | null;
  p?: string | null;
  x1?: string;
  x2?: string;
  k?: string;
}

export interface OfflineManifestPayload {
  ticketIds: string[];
  generatedAt: string;
  event?: { title: string; dateStart: string | null; qrPolicy: string | null };
  totp?: { from: number; slots: number; step: number } | null;
  tickets?: OfflineManifestTicket[];
}

interface ManifestRecord {
  eventId: string;
  /** jen platné (starší formát — zpětná kompatibilita) */
  ticketIds: string[];
  generatedAt: string;
  savedAt: number;
  event?: OfflineManifestPayload['event'];
  totp?: OfflineManifestPayload['totp'];
  tickets?: OfflineManifestTicket[];
}

export interface ManifestMeta {
  count: number;
  generatedAt: string;
  savedAt: number;
}

/** Uloží offline seznam pro akci (stáhnuto z /scanner/manifest). */
export async function saveManifest(eventId: string, manifest: OfflineManifestPayload): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MANIFEST_STORE, 'readwrite');
    const rec: ManifestRecord = {
      eventId,
      ticketIds: manifest.ticketIds.map((t) => t.toLowerCase()),
      generatedAt: manifest.generatedAt,
      savedAt: Date.now(),
      event: manifest.event,
      totp: manifest.totp ?? null,
      tickets: manifest.tickets?.map((t) => ({ ...t, id: t.id.toLowerCase() })),
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
  return { count: m.tickets?.length ?? m.ticketIds.length, generatedAt: m.generatedAt, savedAt: m.savedAt };
}

export type OfflineCheck =
  | 'admitted'
  | 'not_found'
  | 'already_used'
  | 'no_manifest'; // žádný stažený seznam

/** Lokální evidence „použito na tomto zařízení" — vrací true, když už použita byla (jinak ji teď označí). */
async function markLocallyRedeemed(eventId: string, ticketId: string): Promise<boolean> {
  const db = await openDb();
  const key = `${eventId}:${ticketId}`;
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(REDEEMED_STORE, 'readwrite');
    const store = tx.objectStore(REDEEMED_STORE);
    const getReq = store.get(key);
    getReq.onsuccess = () => {
      if (getReq.result) {
        resolve(true);
        return;
      }
      store.put({ key, redeemedAt: Date.now() });
      tx.oncomplete = () => resolve(false);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Offline ověření skenu proti staženému seznamu + lokální evidenci použití (starší rozhraní — jen ID).
 * Při 'admitted' rovnou označí lístek jako lokálně použitý (anti dvojí-vstup).
 */
export async function validateOffline(eventId: string, ticketId: string): Promise<OfflineCheck> {
  const v = await validateOfflineScan(eventId, { ticketId });
  if (!v) return 'no_manifest';
  return v.result === 'admitted' ? 'admitted' : v.result === 'already_used' ? 'already_used' : 'not_found';
}

/** Kolo 14: výsledek offline ověření ve tvaru výsledku online validate (stejné result kódy pro výpis skeneru). */
export interface OfflineVerdict {
  result: 'admitted' | 'not_found' | 'already_used' | 'revoked' | 'invalid_token' | 'totp_required' | 'totp_mismatch';
  message: string;
  usedAt?: string | null;
  ticket?: {
    ticketId: string;
    eventTitle: string;
    ticketTypeName: string;
    holderEmail: string;
    holderName: string | null;
    seat: string | null;
    category: string | null;
    verifyId: string | null;
  };
}

async function sha256Fingerprint(token: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}

const NOT_IN_LIST = 'OFFLINE: lístek NENÍ ve staženém seznamu platných — NEVPOUŠTĚT.';
const USED_HERE = 'OFFLINE: tento lístek už byl tímto zařízením odbaven.';
const ADMITTED = 'Přijato offline (ověřeno proti staženému seznamu). Sync po obnovení.';
const BAD_SIGNATURE = 'Neplatný kód vstupenky (podpis nesedí).';
const REFRESH_LIST = 'OFFLINE: kód nejde ověřit — stáhni seznam znovu.';

/**
 * Kolo 14 (C-50): offline ověření se stejnými pravidly jako online POST /scanner/validate:
 * neznámá vstupenka / jiný termín → not_found; tištěný token s cizím podpisem → invalid_token; politika QR (rotující
 * QR povinné) → totp_required / totp_mismatch; použitá (dříve online i na tomto zařízení) → already_used;
 * zrušená → revoked; kategorie s nárokem → admitted + „Ověřit průkaz". Vrací null, když seznam pro akci chybí.
 */
export async function validateOfflineScan(
  eventId: string,
  input: { ticketId?: string; printToken?: string; totpCode?: string },
  now = Date.now(),
): Promise<OfflineVerdict | null> {
  const m = await getManifest(eventId);
  if (!m) return null;
  const printToken = input.printToken?.trim();
  const id = (printToken ? decodePrintTokenUuid(printToken) : input.ticketId)?.toLowerCase();
  if (!id) return { result: 'invalid_token', message: BAD_SIGNATURE };

  // starší seznam (jen ID platných) — chování jako dřív
  if (!m.tickets) {
    if (!m.ticketIds.includes(id)) return { result: 'not_found', message: NOT_IN_LIST };
    if (await markLocallyRedeemed(eventId, id)) return { result: 'already_used', message: USED_HERE };
    return { result: 'admitted', message: ADMITTED };
  }

  const t = m.tickets.find((x) => x.id === id);
  if (!t) return { result: 'not_found', message: NOT_IN_LIST };
  const ticket = {
    ticketId: t.id,
    eventTitle: m.event?.title ?? '',
    ticketTypeName: t.tt ?? '',
    holderEmail: '',
    holderName: null,
    seat: t.seat ?? null,
    category: t.c ?? null,
    verifyId: t.p ? `Ověřit průkaz: ${t.p}` : null,
  };

  // tištěná vstupenka: podpis = otisk očekávaného tokenu; TXP2 (vázaný na akci) nahrazuje TOTP jako online
  let printVerifiedForEvent = false;
  if (printToken) {
    const isTxp2 = printToken.startsWith('TXP2.');
    if ((await sha256Fingerprint(printToken)) !== (isTxp2 ? t.x2 : t.x1)) {
      return { result: 'invalid_token', message: BAD_SIGNATURE };
    }
    printVerifiedForEvent = isTxp2;
  }

  const qr = qrPolicyDecision({ qrPolicy: m.event?.qrPolicy, eventDateStart: m.event?.dateStart, printVerifiedForEvent, now });
  if (qr.totpRequired && !input.totpCode) return { result: 'totp_required', message: qr.message, ticket };
  if (input.totpCode && !printToken) {
    if (m.totp && t.k) {
      const bin = atob(t.k);
      const counter = Math.floor(now / 1000 / m.totp.step);
      if (counter + 1 - m.totp.from >= m.totp.slots) return { result: 'totp_mismatch', message: REFRESH_LIST, ticket };
      let ok = false;
      for (let off = -1; off <= 1 && !ok; off++) {
        const i = counter + off - m.totp.from;
        if (i < 0 || i >= m.totp.slots) continue;
        const code = (bin.charCodeAt(i * 3) << 16) | (bin.charCodeAt(i * 3 + 1) << 8) | bin.charCodeAt(i * 3 + 2);
        ok = String(code).padStart(6, '0') === input.totpCode;
      }
      if (!ok) return { result: 'totp_mismatch', message: 'TOTP kód neodpovídá.', ticket };
    } else if (qr.totpRequired) {
      return { result: 'totp_mismatch', message: REFRESH_LIST, ticket };
    }
  }

  if (t.s === 'u') return { result: 'already_used', usedAt: t.u ?? null, message: 'OFFLINE: lístek už byl použit.', ticket };
  if (t.s === 'r') return { result: 'revoked', message: 'OFFLINE: lístek byl zrušen — NEVPOUŠTĚT.', ticket };
  if (await markLocallyRedeemed(eventId, id)) return { result: 'already_used', message: USED_HERE, ticket };
  return { result: 'admitted', message: ADMITTED, ticket };
}

/**
 * Klientský (bez secretu) dekodér ticket UUID z tištěného print tokenu
 * `TXP1.<b64url(uuid16+hmac10)>`. Podpis se offline ověřuje otiskem očekávaného tokenu v seznamu
 * (`validateOfflineScan`). Vrací UUID nebo null, když to není print token.
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
