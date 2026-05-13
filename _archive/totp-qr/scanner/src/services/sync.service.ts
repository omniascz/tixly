import { upsertTickets } from "../db/offline-cache";
import type { TicketRow } from "../db/offline-cache";

const SYNC_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Wire types that match the server's GET /api/gate/sync response shape
// ---------------------------------------------------------------------------

interface ServerTicket {
  ticketId: string;
  totpSecretEncrypted: string; // base64
  totpSecretIv: string;        // base64
  status: "active" | "revoked" | "used";
  holderName: string;
  seatInfo: string;
}

interface SyncResponse {
  tickets: ServerTicket[];
  serverTime: number; // unix seconds
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toTicketRow(t: ServerTicket): TicketRow {
  return {
    ticket_id: t.ticketId,
    totp_secret_encrypted: Buffer.from(t.totpSecretEncrypted, "base64"),
    totp_secret_iv: Buffer.from(t.totpSecretIv, "base64"),
    status: t.status,
    holder_name: t.holderName,
    seat_info: t.seatInfo,
    synced_at: Math.floor(Date.now() / 1000),
  };
}

async function fetchSync(url: string, authToken: string): Promise<SyncResponse> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`SYNC_FETCH_FAILED: HTTP ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<SyncResponse>;
}

// ---------------------------------------------------------------------------
// Public sync functions
// ---------------------------------------------------------------------------

const BASE_URL =
  typeof process !== "undefined" && process.env.GATE_API_URL
    ? process.env.GATE_API_URL
    : "https://api.tixly.example";

/**
 * Downloads the complete ticket dataset for an event.
 * Intended to be called ~4 hours before the event starts so the scanner
 * can operate fully offline from the start.
 */
export async function fullSync(
  eventId: string,
  authToken: string
): Promise<void> {
  const url = `${BASE_URL}/api/gate/sync?event_id=${encodeURIComponent(eventId)}`;
  const data = await fetchSync(url, authToken);
  upsertTickets(data.tickets.map(toTicketRow));
}

/**
 * Downloads only tickets changed since `since` (unix seconds).
 * Merges them into the local SQLite cache via upsert.
 * Network errors are caught and logged — the scanner continues offline.
 */
export async function deltaSync(
  eventId: string,
  since: number,
  authToken: string
): Promise<void> {
  const url = `${BASE_URL}/api/gate/sync?event_id=${encodeURIComponent(eventId)}&since=${since}`;
  try {
    const data = await fetchSync(url, authToken);
    upsertTickets(data.tickets.map(toTicketRow));
  } catch (err) {
    // Do not surface network errors to the UI — continue with cached data
    const message = err instanceof Error ? err.message : String(err);
    // Use structured logging in production; console acceptable for PWA edge
    console.warn(`[sync] Delta sync failed (continuing offline): ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Background scheduler
// ---------------------------------------------------------------------------

let _syncInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the background delta-sync loop (every 30 seconds).
 * Safe to call once per scanner session.
 */
export function startDeltaSyncLoop(
  eventId: string,
  authToken: string,
  getLastSyncTime: () => number
): void {
  if (_syncInterval !== null) {
    return; // already running
  }
  _syncInterval = setInterval(() => {
    const since = getLastSyncTime();
    void deltaSync(eventId, since, authToken);
  }, SYNC_INTERVAL_MS);
}

/**
 * Stops the background delta-sync loop.
 */
export function stopDeltaSyncLoop(): void {
  if (_syncInterval !== null) {
    clearInterval(_syncInterval);
    _syncInterval = null;
  }
}
