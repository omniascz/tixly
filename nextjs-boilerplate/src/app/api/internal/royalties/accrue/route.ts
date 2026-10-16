/**
 * POST /api/internal/royalties/accrue
 * Interní endpoint volaný z /api/internal/order-completed po dokončení platby.
 * Spočítá royalty pro všechny aktivní smlouvy na akci a zapíše do ledgeru.
 *
 * Body: { orderId: string }
 * Auth: x-internal-token header
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { verifyInternalToken } from '@/lib/internal-auth';
import { computeOrderRoyalty } from '@/lib/royalties/compute';
import type { RoyaltyAgreement } from '@/lib/royalties/compute';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const auth = verifyInternalToken(req.headers.get('x-internal-token'));
  if (!auth.ok) {
    // Hlasitě — tichá 401 tady znamenala, že se podíly umělců nikdy nenačetly.
    console.error('[royalties/accrue] odmítnuto:', auth.reason);
    return NextResponse.json({ error: 'Unauthorized', reason: auth.reason }, { status: 401 });
  }

  const { orderId } = await req.json() as { orderId?: string };
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 });

  // Načíst objednávku + revenue per ticket type
  const orderR = await runWithServiceContext(() =>
    db().query(
      `SELECT o.id, o.event_id, o.status,
              COALESCE(SUM(oi.total_price), 0)::int AS total_revenue,
              COALESCE(SUM(oi.quantity), 0)::int      AS total_tickets
       FROM orders.orders o
       LEFT JOIN orders.order_items oi ON oi.order_id = o.id
       WHERE o.id=$1
       GROUP BY o.id`,
      [orderId],
    ),
  );
  if (orderR.rows.length === 0) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const order = orderR.rows[0] as {
    id: string; event_id: string; status: string;
    total_revenue: number; total_tickets: number;
  };
  if (order.status !== 'paid' && order.status !== 'completed') {
    return NextResponse.json({ skipped: 'order not paid' });
  }

  // Aktivní smlouvy pro tuto akci
  const agreeR = await runWithServiceContext(() =>
    db().query(
      `SELECT id, royalty_type, percent_rate, flat_amount_halire,
              per_ticket_halire, min_guarantee_halire, cap_halire,
              included_ticket_type_ids
       FROM lineups.royalty_agreements
       WHERE event_id=$1 AND status='active'`,
      [order.event_id],
    ),
  );
  if (agreeR.rows.length === 0) return NextResponse.json({ accrued: 0 });

  const results: Array<{ agreementId: string; royaltyHalire: number }> = [];

  for (const agree of agreeR.rows as Array<RoyaltyAgreement & { id: string; included_ticket_type_ids: string[] | null }>) {
    // Pokud smlouva filtruje typy lístků, přepočítáme revenue jen za relevantní
    let revenue = order.total_revenue;
    let tickets = order.total_tickets;

    if (agree.included_ticket_type_ids && agree.included_ticket_type_ids.length > 0) {
      const filtR = await runWithServiceContext(() =>
        db().query(
          `SELECT COALESCE(SUM(oi.total_price), 0)::int AS rev,
                  COALESCE(SUM(oi.quantity), 0)::int    AS tix
           FROM orders.order_items oi
           WHERE oi.order_id=$1
             AND oi.ticket_type_id = ANY($2::uuid[])`,
          [orderId, agree.included_ticket_type_ids],
        ),
      );
      revenue = filtR.rows[0]?.rev ?? 0;
      tickets = filtR.rows[0]?.tix ?? 0;
    }

    const royaltyAmount = computeOrderRoyalty(agree, revenue, tickets);

    // INSERT idempotentně (UNIQUE(agreement_id, order_id))
    await runWithServiceContext(() =>
      db().query(
        `INSERT INTO lineups.royalty_ledger
           (agreement_id, order_id, ticket_revenue_halire, tickets_sold, royalty_amount_halire)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (agreement_id, order_id) DO NOTHING`,
        [agree.id, orderId, revenue, tickets, royaltyAmount],
      ),
    );

    results.push({ agreementId: agree.id, royaltyHalire: royaltyAmount });
  }

  return NextResponse.json({ accrued: results.length, results });
}
