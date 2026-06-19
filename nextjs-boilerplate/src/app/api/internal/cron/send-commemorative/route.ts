import { timingSafeEqual } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return runWithServiceContext(async () => {
    const events = await db().query<{ id: string }>(
      `SELECT DISTINCT o.event_id AS id
         FROM tickets.tickets t
         JOIN orders.orders o ON o.id = t.order_id
         JOIN catalog.commemorative_templates ct ON ct.event_id = o.event_id
        WHERE t.status = 'used'
          AND t.commemorative_sent_at IS NULL
          AND ct.is_active = true`,
    );

    if (events.rows.length === 0) {
      return NextResponse.json({ processed: 0 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? '';
    let totalSent = 0;

    for (const event of events.rows) {
      try {
        const res = await fetch(`${appUrl}/api/admin/commemorative/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-token': internalToken,
          },
          body: JSON.stringify({ eventId: event.id }),
        });
        if (res.ok) {
          const j = (await res.json().catch(() => ({}))) as { sent?: number };
          totalSent += j.sent ?? 0;
        }
      } catch {
        // non-fatal
      }
    }

    return NextResponse.json({ processed: events.rows.length, sent: totalSent });
  });
}
