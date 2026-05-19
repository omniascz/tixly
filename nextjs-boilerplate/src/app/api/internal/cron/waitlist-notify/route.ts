/**
 * POST /api/internal/cron/waitlist-notify
 *
 * Pro každý ticket_type s nenulovým remaining_qty zkontroluje waitlist:
 *   - kolik je waiting entries
 *   - kolik je free (remaining_qty - already_notified s nepřevedeným notification)
 *   - notify nejstarší N entries → status='notified', notification_expires_at=NOW()+30min
 *   - pošle email s reservation linkem (mock-friendly via /api/internal/waitlist-email)
 *
 * Auth: x-internal-token.
 */

import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const NOTIFICATION_TTL_MIN = 30;

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Expire stale notifications first
  const expired = await db().query(
    `UPDATE catalog.waitlist_entries
     SET status = 'expired'
     WHERE status = 'notified' AND notification_expires_at <= NOW()
     RETURNING id`,
  );

  // Find ticket_types with free inventory + waiting entries
  const candidates = await db().query<{
    ticket_type_id: string;
    free_qty: number;
    waiting_count: number;
  }>(
    `SELECT tt.id AS ticket_type_id,
            tt.remaining_qty -
              COALESCE((SELECT COUNT(*) FROM catalog.waitlist_entries we2
                        WHERE we2.ticket_type_id = tt.id AND we2.status = 'notified'), 0) AS free_qty,
            (SELECT COUNT(*)::int FROM catalog.waitlist_entries we3
             WHERE we3.ticket_type_id = tt.id AND we3.status = 'waiting') AS waiting_count
     FROM catalog.ticket_types tt
     WHERE tt.remaining_qty IS NOT NULL AND tt.remaining_qty > 0
       AND EXISTS (SELECT 1 FROM catalog.waitlist_entries we
                   WHERE we.ticket_type_id = tt.id AND we.status = 'waiting')`,
  );

  let notified = 0;
  for (const tt of candidates.rows) {
    if (tt.free_qty <= 0 || tt.waiting_count <= 0) continue;
    const limit = Math.min(tt.free_qty, tt.waiting_count);

    const upd = await db().query<{
      id: string;
      email: string;
      name: string | null;
      ticket_type_name: string;
      event_id: string;
      event_title: string;
    }>(
      `WITH next_batch AS (
         SELECT id FROM catalog.waitlist_entries
         WHERE ticket_type_id = $1 AND status = 'waiting'
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE
       )
       UPDATE catalog.waitlist_entries we
       SET status = 'notified',
           notified_at = NOW(),
           notification_expires_at = NOW() + INTERVAL '${NOTIFICATION_TTL_MIN} minutes'
       FROM next_batch nb, catalog.ticket_types tt, catalog.events e
       WHERE we.id = nb.id AND tt.id = we.ticket_type_id AND e.id = tt.event_id
       RETURNING we.id, we.email, we.name, tt.name AS ticket_type_name,
                 e.id AS event_id, e.title AS event_title`,
      [tt.ticket_type_id, limit],
    );
    notified += upd.rows.length;

    // Trigger emails (out of transaction)
    for (const row of upd.rows) {
      const buyUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/cs/events/${row.event_id}?ticketTypeId=${tt.ticket_type_id}&waitlistId=${row.id}`;
      void fetch(
        `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/internal/waitlist-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN ?? '',
          },
          body: JSON.stringify({
            toEmail: row.email,
            toName: row.name,
            eventTitle: row.event_title,
            ticketTypeName: row.ticket_type_name,
            buyUrl,
            ttlMin: NOTIFICATION_TTL_MIN,
          }),
        },
      ).catch((err) => console.error('[waitlist email]', err));
    }
  }

  return NextResponse.json({
    ok: true,
    expired: expired.rows.length,
    notified,
    candidatesProcessed: candidates.rows.length,
  });
}
