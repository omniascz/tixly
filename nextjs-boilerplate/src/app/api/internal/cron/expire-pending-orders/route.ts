/**
 * POST /api/internal/cron/expire-pending-orders
 *
 * Najde orders.status='pending' s expires_at < now() a:
 *   - status → 'expired'
 *   - uvolní held event_seats (status → 'available')
 *   - restore remaining_qty z order_items
 *
 * Spouštět 1× za 5 min (nebo přes Vercel cron 1× minuty).
 * Bezpečnost: x-internal-token.
 */

import { timingSafeEqual } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { releaseOrderCapacity } from '@/lib/orders/release-capacity';
import { NextRequest, NextResponse } from 'next/server';


function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const client = await db().connect();
  let expiredCount = 0;
  let seatsReleased = 0;
  try {
    await client.query('BEGIN');

    // Najdi expired pending orders
    const expired = await client.query<{ id: string }>(
      `SELECT id FROM orders.orders o
       WHERE status = 'pending' AND expires_at < now()
         -- kolo 8 / krok 5: rezervace na pokladně uzavírá cron seat-reservations (e-mail kupci + stav rezervace)
         AND NOT EXISTS (SELECT 1 FROM orders.seat_reservations r WHERE r.order_id = o.id AND r.status = 'active')
         -- kolo 8 / krok 6: firemní objednávka na fakturu drží místa do zaplacení / ručního uvolnění
         AND NOT EXISTS (SELECT 1 FROM b2b_orders.invoice_orders io WHERE io.order_id = o.id)
       FOR UPDATE
       LIMIT 500`,
    );
    expiredCount = expired.rows.length;

    if (expiredCount > 0) {
      const orderIds = expired.rows.map((r) => r.id);

      // 1) Update status → expired
      await client.query(
        `UPDATE orders.orders
           SET status = 'expired', updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [orderIds],
      );

      // 2+3) GA množství, sedadla linknutá na objednávku i promo max_uses — přes
      //       sdílený helper (tentýž, který volá webhook při zrušené platbě).
      //       FIX K3: dřívější krok 3 sahal na `order_items.event_seat_id`, který
      //       ve schématu NEEXISTUJE (sloupec je `seat_id`) → 42703 → cron vracel
      //       500 a nic neuvolnil. Kapacita tak zůstávala zamčená navždy.
      const rel = await releaseOrderCapacity(client, orderIds);
      seatsReleased = rel.seatsReleased;

      // 4) Audit log per order
      for (const id of orderIds) {
        await client.query(
          `INSERT INTO audit.audit_log
             (schema_name, table_name, record_id, action, actor_type, new_values)
           VALUES ('orders', 'orders', $1, 'UPDATE', 'system', $2::jsonb)`,
          [id, JSON.stringify({ kind: 'expired_by_cron', status: 'expired' })],
        );
      }
    }

    // 5) SEATED hold: pending seated objednávky drží sedadla přes hold_until (ne přes
    //    order_id). FIX K3 („expirace uvolní i sedadla"): ve stejné transakci vrátíme
    //    do prodeje všechna sedadla s prošlým holdem — totožná logika jako
    //    `release-expired-seat-holds`, idempotentní.
    const heldRes = await client.query(
      `UPDATE catalog.event_seats
          SET status = 'available', hold_user_id = NULL, hold_until = NULL,
              notes = NULL, updated_at = now()
        WHERE status = 'held' AND hold_until IS NOT NULL AND hold_until < now()`,
    );
    seatsReleased += heldRes.rowCount ?? 0;

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      expiredCount,
      seatsReleased,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[expire-pending-orders]', e);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  });
}
