/**
 * ForgeMsg dispatcher — drains the outbox to ForgeMsg's ticketing ingest API.
 *
 * Groups pending rows by promoter (→ ForgeMsg org), resolves each promoter's API
 * key (forgemsg_credentials, else the platform default env key), and POSTs a
 * batch. Marks rows sent/failed; failed rows retry until MAX_ATTEMPTS, then park
 * as 'failed' for inspection.
 */
import { db } from '@/lib/db/rls-pool';

const MAX_ATTEMPTS = 6;
const BATCH = 200;

interface OutboxRow {
  id: string;
  promoter_id: string | null;
  event_type: string;
  payload: unknown;
}

interface Creds {
  apiKey: string;
  apiUrl: string;
}

async function resolveCreds(promoterId: string | null): Promise<Creds | null> {
  const defaultUrl = process.env.FORGEMSG_API_URL ?? '';
  const defaultKey = process.env.FORGEMSG_API_KEY ?? '';

  if (promoterId) {
    const r = await db().query<{ api_key: string; api_url: string | null; enabled: boolean }>(
      `SELECT api_key, api_url, enabled FROM public.forgemsg_credentials WHERE promoter_id = $1`,
      [promoterId],
    );
    const row = r.rows[0];
    if (row && row.enabled) {
      return { apiKey: row.api_key, apiUrl: row.api_url ?? defaultUrl };
    }
  }
  if (defaultKey && defaultUrl) return { apiKey: defaultKey, apiUrl: defaultUrl };
  return null; // not configured → leave pending
}

export interface DispatchResult {
  picked: number;
  sent: number;
  failed: number;
  skipped: number;
}

export async function dispatchOutbox(): Promise<DispatchResult> {
  const result: DispatchResult = { picked: 0, sent: 0, failed: 0, skipped: 0 };

  const pending = await db().query<OutboxRow>(
    `SELECT id, promoter_id, event_type, payload
       FROM public.forgemsg_outbox
      WHERE status = 'pending'
      ORDER BY created_at
      LIMIT $1`,
    [BATCH],
  );
  result.picked = pending.rows.length;
  if (pending.rows.length === 0) return result;

  // Group by promoter so each batch uses the right org credentials.
  const byPromoter = new Map<string | null, OutboxRow[]>();
  for (const row of pending.rows) {
    const k = row.promoter_id;
    (byPromoter.get(k) ?? byPromoter.set(k, []).get(k)!).push(row);
  }

  for (const [promoterId, rows] of byPromoter) {
    const creds = await resolveCreds(promoterId);
    if (!creds) {
      result.skipped += rows.length; // stays pending until credentials exist
      continue;
    }

    let ok = false;
    let errMsg = '';
    try {
      const res = await fetch(`${creds.apiUrl}/api/v1/ticketing/events/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': creds.apiKey },
        body: JSON.stringify({ events: rows.map((r) => r.payload) }),
      });
      ok = res.ok;
      if (!ok) errMsg = `HTTP ${res.status}`;
    } catch (e) {
      errMsg = e instanceof Error ? e.message : String(e);
    }

    const ids = rows.map((r) => r.id);
    if (ok) {
      await db().query(
        `UPDATE public.forgemsg_outbox SET status = 'sent', sent_at = now() WHERE id = ANY($1::bigint[])`,
        [ids],
      );
      result.sent += rows.length;
    } else {
      await db().query(
        `UPDATE public.forgemsg_outbox
            SET attempts = attempts + 1,
                last_error = $2,
                status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE 'pending' END
          WHERE id = ANY($1::bigint[])`,
        [ids, errMsg, MAX_ATTEMPTS],
      );
      result.failed += rows.length;
    }
  }

  return result;
}
