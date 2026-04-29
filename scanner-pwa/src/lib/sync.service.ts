// ---------------------------------------------------------------------------
// Sync service — runs every 15 minutes when online.
// Refreshes the event's ticket index and flushes pending offline scans.
// ---------------------------------------------------------------------------
import {
  cacheTickets,
  getPendingScans,
  markScanSynced,
  setLastSyncAt,
  type TicketCacheRow,
} from './offline-cache.js';

export const SYNC_INTERVAL_MS = 15 * 60 * 1000;

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

interface FetchTicketsResponse {
  tickets: TicketCacheRow[];
  serverTime: number;
}

async function safeFetch(
  url: string,
  init: RequestInit
): Promise<Response | null> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
}

/**
 * Fetches the full ticket index for an event and upserts it into the cache.
 * Returns `{ cached: 0 }` if offline or the request fails.
 */
export async function syncEventTickets(
  eventId: string,
  authToken: string
): Promise<{ cached: number }> {
  const url = `${API_BASE}/api/scanner/events/${eventId}/tickets`;
  const res = await safeFetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res || !res.ok) return { cached: 0 };

  let data: FetchTicketsResponse;
  try {
    data = (await res.json()) as FetchTicketsResponse;
  } catch {
    return { cached: 0 };
  }

  await cacheTickets(data.tickets);
  await setLastSyncAt(Date.now());
  return { cached: data.tickets.length };
}

/**
 * Posts all queued offline scans to the backend in a batch.
 * On success, marks them as synced in the local cache.
 */
export async function flushPendingScans(
  authToken: string
): Promise<{ synced: number; failed: number }> {
  const pending = await getPendingScans();
  if (pending.length === 0) return { synced: 0, failed: 0 };

  const url = `${API_BASE}/api/scanner/scans/batch`;
  const res = await safeFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ scans: pending }),
  });

  if (!res || !res.ok) {
    return { synced: 0, failed: pending.length };
  }

  let synced = 0;
  for (const s of pending) {
    if (s.scanId !== undefined) {
      await markScanSynced(s.scanId);
      synced++;
    }
  }
  return { synced, failed: pending.length - synced };
}

/**
 * Runs a full sync cycle: refresh tickets + flush pending scans.
 */
export async function runSyncCycle(
  eventId: string,
  authToken: string
): Promise<{ cached: number; synced: number }> {
  const { cached } = await syncEventTickets(eventId, authToken);
  const { synced } = await flushPendingScans(authToken);
  return { cached, synced };
}
