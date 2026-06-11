/**
 * GET /api/admin/scanner/manifest?eventId=<uuid>[&eventDayId=<uuid>]
 *
 * Vrátí seznam ID platných (status='valid') vstupenek pro danou akci promotéra.
 * Scanner si ho stáhne PŘED začátkem představení a uloží do IndexedDB. Při výpadku
 * sítě pak offline ověřuje sken proti tomuto whitelistu (+ lokální evidence použití),
 * místo slepého „optimistic accept" — padělaný / cizí lístek se offline odmítne.
 *
 * Bezpečnost: scoped na promotéra (vlastní akce), runAsActivePromoter. Vrací jen
 * holá ticket UUID (to, co stejně je v QR), žádné PII. Strop 100k řádků.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const url = new URL(req.url);
    const eventId = url.searchParams.get('eventId');
    if (!eventId || !UUID_RE.test(eventId)) {
      return NextResponse.json({ error: 'eventId required' }, { status: 422 });
    }

    // Ownership: akce musí patřit promotérovi (RLS je v prod dormantní).
    const owns = await db().query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [eventId, promoter.promoterId],
    );
    if (owns.rowCount === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const r = await db().query<{ id: string }>(
      `SELECT t.id
         FROM tickets.tickets t
         JOIN orders.orders o ON o.id = t.order_id
        WHERE o.event_id = $1
          AND t.status = 'valid'
        ORDER BY t.id
        LIMIT 100000`,
      [eventId],
    );

    return NextResponse.json({
      eventId,
      ticketIds: r.rows.map((x) => x.id),
      count: r.rowCount,
      generatedAt: new Date().toISOString(),
    });
  });
}
