/**
 * GET /api/reseller/orders/[orderId]/tickets — vstupenky objednávky pro tisk u prodejce.
 *
 * Kolo 3: kontext prodejce = ověřený token prodejce (requireReseller, Bearer). Vstupenky se vydají
 * JEN když objednávku prodal TENTO prodejce (orders.reseller_sales.partner_id); jinak 404
 * (nerozlišujeme „neexistuje" a „cizí"). Čtení běží v servisním kontextu jako ostatní reseller API,
 * ale je omezené na ověřenou objednávku prodejce.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireReseller, type ResellerSession } from '@/lib/reseller-auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { signEventPrintToken } from '@/lib/tickets/print-token';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, props: { params: Promise<{ orderId: string }> }): Promise<Response> {
  const params = await props.params;
  let session: ResellerSession;
  try {
    session = await requireReseller(req);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  if (!UUID_RE.test(params.orderId)) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  return runWithServiceContext(async () => {
    const own = await db().query(
      `SELECT 1 FROM orders.reseller_sales WHERE order_id = $1 AND partner_id = $2 LIMIT 1`,
      [params.orderId, session.partnerId],
    );
    if (own.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const r = await db().query<{
      id: string; event_id: string; event_title: string; date_start: string; venue_name: string;
      ticket_type_name: string; seat_label: string | null; buyer_name: string | null;
      buyer_email: string; serial: string;
    }>(
      `SELECT t.id,
              o.event_id,
              e.title AS event_title,
              e.date_start,
              v.name AS venue_name,
              tt.name AS ticket_type_name,
              CASE WHEN es.id IS NOT NULL
                THEN es.sector || ' ' || es.row || es.seat_number::text
                ELSE NULL
              END AS seat_label,
              u.name AS buyer_name,
              u.email AS buyer_email,
              UPPER(SUBSTRING(t.id::text, 1, 8)) AS serial
         FROM tickets.tickets t
         JOIN orders.orders o ON o.id = t.order_id
         JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
         JOIN catalog.events e ON e.id = tt.event_id
         JOIN catalog.venues v ON v.id = e.venue_id
         JOIN identity.users u ON u.id = o.user_id
         LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
        WHERE t.order_id = $1
        ORDER BY t.id`,
      [params.orderId],
    );
    // Kolo 4: tištěná vstupenka nese podepsaný statický token TXP2 (vstupenka + akce), který
    // skener ověří podpisem — i pod qr_policy rotating_24h, kde tištěný papír TOTP nemá.
    return NextResponse.json({
      tickets: r.rows.map((t) => ({ ...t, printToken: signEventPrintToken(t.id, t.event_id) })),
    });
  });
}
