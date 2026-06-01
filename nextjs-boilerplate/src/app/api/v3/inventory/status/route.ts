/**
 * GET /api/v3/inventory/status
 *
 * Real-time inventory snapshot napříč všemi published events.
 * Query: ?eventId=<uuid> (single event) NEBO ?promoterId=<uuid> (filter)
 * Materialized view (refresh á 1 min cron).
 *
 * Scope: read_events
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { requireApiAuth, rateLimitCheck } from '@/lib/oauth/guard';

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await requireApiAuth(req, 'read_events');
  if (!auth.ok) return auth.response;

  const rl = await rateLimitCheck(auth.ctx, '/api/v3/inventory/status', 'GET');
  if (!rl.ok) return rl.response;

  // Agregátní inventory MV (mv_event_inventory_status), filtruje v WHERE; ?promoterId=
  // záměrně cross-promoter → service kontext (MV nemá tenant RLS).
  return runWithServiceContext(async () => {
  const url = new URL(req.url);
  const eventId = url.searchParams.get('eventId');
  const promoterIdParam = url.searchParams.get('promoterId');

  // Auth-aware scope: caller's promoter má vždy přístup, jiné public events
  const promoterFilter = promoterIdParam ?? auth.ctx.promoterId;

  const conditions: string[] = [];
  const args: unknown[] = [];

  if (eventId) {
    args.push(eventId);
    conditions.push(`event_id = $${args.length}`);
  } else if (promoterFilter) {
    args.push(promoterFilter);
    conditions.push(`promoter_id = $${args.length}`);
  }

  const r = await db().query<{
    event_id: string;
    ticket_type_count: number;
    total_capacity: number;
    total_remaining: number;
    total_sold: number;
    min_price: number;
    max_price: number;
    availability_status: string;
    snapshot_at: string;
  }>(
    `SELECT event_id, ticket_type_count, total_capacity, total_remaining, total_sold,
            min_price, max_price, availability_status, snapshot_at::text
       FROM catalog.mv_event_inventory_status
       ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
   ORDER BY total_sold DESC
      LIMIT 100`,
    args,
  );

  return NextResponse.json({
    events: r.rows,
    snapshot_refreshed_at: r.rows[0]?.snapshot_at,
    pagination: { count: r.rows.length, has_more: false },
  });
  });
}
