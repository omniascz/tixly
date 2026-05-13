// ---------------------------------------------------------------------------
// Delta sync service — syncs ticket cache with the backend
// ---------------------------------------------------------------------------
import {
  upsertTickets,
  revokeTickets,
  countCachedTickets,
  getMetadata,
  setMetadata,
} from "../db/offline-cache";
import type { TicketRow, TicketSyncRow } from "../types/scanner.types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncResult {
  added: number;
  updated: number;
  deleted: number;
  totalCached: number;
  syncedAt: string; // ISO
}

export interface SyncDeps {
  /** Base URL of the Tixly API, e.g. "https://api.tixly.io" */
  apiBaseUrl: string;
  /** Bearer token / device API key */
  apiKey: string;
  /** Optional fetch override for testing */
  fetch?: typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const LAST_SYNC_KEY = (eventId: string) => `lastSyncAt:${eventId}`;

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function mapSyncRow(row: TicketSyncRow): TicketRow {
  return {
    ticket_id: row.ticket_id,
    totp_secret_encrypted: base64ToUint8Array(row.totp_secret_encrypted),
    totp_secret_iv: base64ToUint8Array(row.totp_secret_iv),
    status: row.status,
    holder_name: row.holder_name,
    seat_info: row.seat_info,
    synced_at: row.synced_at,
  };
}

interface DeltaResponse {
  tickets: TicketSyncRow[];
  deletedIds: string[];
  serverTime: number;
}

async function fetchDelta(
  eventId: string,
  since: number,
  deps: SyncDeps
): Promise<DeltaResponse> {
  const f = deps.fetch ?? globalThis.fetch;
  const url = `${deps.apiBaseUrl}/api/scanner/events/${eventId}/tickets/delta?since=${since}`;
  const res = await f(url, {
    headers: {
      Authorization: `Bearer ${deps.apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Sync failed: HTTP ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<DeltaResponse>;
}

// ---------------------------------------------------------------------------
// Core sync logic
// ---------------------------------------------------------------------------

/**
 * Performs a delta sync for a given event.
 *
 * Algorithm:
 * 1. Read lastSyncAt from metadata table (0 = full sync).
 * 2. Fetch /api/scanner/events/{eventId}/tickets/delta?since={lastSyncAt}.
 * 3. Upsert new/changed tickets.
 * 4. Revoke deletedIds (soft-delete → status='revoked').
 * 5. Persist serverTime as new lastSyncAt.
 * 6. Return summary counts.
 */
export async function syncEvent(
  eventId: string,
  deps: SyncDeps
): Promise<SyncResult> {
  const sinceRaw = getMetadata(LAST_SYNC_KEY(eventId));
  const since = sinceRaw ? parseInt(sinceRaw, 10) : 0;

  const delta = await fetchDelta(eventId, since, deps);

  // Separate new vs updated tickets (both go through upsert)
  const existingIds = new Set<string>();
  // We can't efficiently know which are new vs updated without querying
  // each one, so we track counts via the delta metadata from the server.
  // In absence of server-side distinction, all are treated as upserts.
  const incoming = delta.tickets.map(mapSyncRow);

  // We need to know how many already existed to split added/updated.
  // Simple heuristic: count rows that have synced_at >= since.
  // The server provides serverTime; tickets with synced_at == serverTime
  // in the delta are "new" in the strictest sense, but this is approximate.
  // For the purposes of the SyncResult we do a best-effort split:
  //   - tickets whose synced_at == serverTime → added
  //   - rest → updated
  const added = incoming.filter((t) => t.synced_at >= delta.serverTime).length;
  const updated = incoming.length - added;

  upsertTickets(incoming);
  revokeTickets(delta.deletedIds);

  // Persist new sync timestamp only on success
  setMetadata(LAST_SYNC_KEY(eventId), String(delta.serverTime));

  const totalCached = countCachedTickets();

  return {
    added,
    updated,
    deleted: delta.deletedIds.length,
    totalCached,
    syncedAt: new Date(delta.serverTime * 1000).toISOString(),
  };
}

/**
 * Forces a full sync by fetching from timestamp 0 (ignoring stored lastSyncAt).
 * Resets the stored lastSyncAt to 0 so the next automatic sync also starts fresh.
 */
export async function forcSync(
  eventId: string,
  deps: SyncDeps
): Promise<SyncResult> {
  // Reset persisted timestamp first
  setMetadata(LAST_SYNC_KEY(eventId), "0");

  // Fetch delta from the beginning of time
  const delta = await fetchDelta(eventId, 0, deps);

  const incoming = delta.tickets.map(mapSyncRow);
  const added = incoming.filter((t) => t.synced_at >= delta.serverTime).length;
  const updated = incoming.length - added;

  upsertTickets(incoming);
  revokeTickets(delta.deletedIds);

  // Persist new sync timestamp
  setMetadata(LAST_SYNC_KEY(eventId), String(delta.serverTime));

  const totalCached = countCachedTickets();

  return {
    added,
    updated,
    deleted: delta.deletedIds.length,
    totalCached,
    syncedAt: new Date(delta.serverTime * 1000).toISOString(),
  };
}
