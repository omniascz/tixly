/**
 * GET /api/buyer/my-tickets
 *
 * List všech kupcových lístků s relevant context:
 *   - event title + date
 *   - status (valid / used / revoked)
 *   - flex pass info (pass_kind, picks_required, picks_used)
 *   - insurance info (premium, status)
 *   - upcoming/past
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface TicketRow {
  id: string;
  status: string;
  used_at: string | null;
  revoked_at: string | null;
  order_id: string;
  event_id: string;
  event_title: string;
  event_date: string;
  ticket_type_id: string;
  ticket_type_name: string;
  venue_name: string | null;
  pass_kind: string | null;
  picks_required: number | null;
  picks_used: number;
  redemption_count: number;
  order_status: string;
  order_currency: string;
  insurance_status: string | null;
  insurance_premium: number | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<TicketRow>(
    `SELECT t.id, t.status, t.used_at, t.revoked_at,
            o.id AS order_id, o.status AS order_status, o.currency AS order_currency,
            e.id AS event_id, e.title AS event_title, e.date_start AS event_date,
            tt.id AS ticket_type_id, tt.name AS ticket_type_name,
            v.name AS venue_name,
            f.pass_kind, f.picks_required,
            (SELECT COUNT(*)::int FROM tickets.ticket_picks WHERE ticket_id = t.id) AS picks_used,
            (SELECT COUNT(*)::int FROM tickets.ticket_redemptions WHERE ticket_id = t.id) AS redemption_count,
            ins.status AS insurance_status,
            ins.premium_amount AS insurance_premium
     FROM tickets.tickets t
     JOIN orders.orders o ON o.id = t.order_id
     JOIN catalog.events e ON e.id = o.event_id
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
     LEFT JOIN catalog.flex_pass_settings f ON f.ticket_type_id = tt.id
     LEFT JOIN orders.order_insurance ins ON ins.order_id = o.id
     WHERE t.owner_id = $1
     ORDER BY e.date_start DESC
     LIMIT 200`,
    [userId],
  );

  return NextResponse.json({ tickets: r.rows });
}
