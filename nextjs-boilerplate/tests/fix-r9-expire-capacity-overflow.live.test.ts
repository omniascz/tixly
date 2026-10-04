// @vitest-environment node
/**
 * Kolo 9 / krok 2 (nález z auditu 12 na integrate): jediná propadlá objednávka, jejíž vytvoření NESNÍŽILO
 * remaining_qty (např. claim skupinové pozvánky — sedadlo drží order_id, kapacita typu se neodečítá), shodila
 * cron expire-pending-orders: vrácení kapacity by přesáhlo total_qty → CHECK chk_catalog_ticket_types_remaining →
 * ROLLBACK celé dávky → NIC nepropadne a místa ostatních objednávek zůstanou zamčená.
 *
 * Očekávané: cron vrátí 200, všechny propadlé objednávky jsou expired, remaining_qty nikdy nepřesáhne total_qty.
 */
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest) => Promise<Response>;

run('Kolo 9 — expirace nezastaví objednávka bez odečtené kapacity', () => {
  let clone: LocalClone;
  beforeAll(async () => { clone = await createLocalClone(); }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 60_000);

  it('cron projde, obě propadlé objednávky expired, kapacita ≤ total', async () => {
    // A: typ bez odečtené kapacity (remaining = total) + propadlá pending objednávka na sedadlo
    const a = await clone.seed.chain({ totalQty: 5, remainingQty: 5 });
    const seatA = (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, status) VALUES ($1,$2,'A','1','1','available') RETURNING id`,
      [a.eventId, a.ticketTypeId])).rows[0].id;
    const buyer = await clone.seed.user('exp', 'Exp');
    const oA = randomUUID();
    await clone.pool.query(`INSERT INTO orders.orders (id, user_id, event_id, status, total_amount, currency, expires_at) VALUES ($1,$2,$3,'pending',10000,'CZK', now() - interval '1 minute')`, [oA, buyer.id, a.eventId]);
    await clone.pool.query(`INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price, seat_id) VALUES ($1,$2,1,10000,10000,$3)`, [oA, a.ticketTypeId, seatA]);
    await clone.pool.query(`UPDATE catalog.event_seats SET status='sold', order_id=$2 WHERE id=$1`, [seatA, oA]);
    // B: běžná propadlá objednávka (kapacita odečtená: remaining 4 z 5)
    const b = await clone.seed.chain({ totalQty: 5, remainingQty: 4 });
    const oB = randomUUID();
    await clone.pool.query(`INSERT INTO orders.orders (id, user_id, event_id, status, total_amount, currency, expires_at) VALUES ($1,$2,$3,'pending',10000,'CZK', now() - interval '1 minute')`, [oB, buyer.id, b.eventId]);
    await clone.pool.query(`INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price) VALUES ($1,$2,1,10000,10000)`, [oB, b.ticketTypeId]);

    const { POST } = await import('@/app/api/internal/cron/expire-pending-orders/route');
    const r = await (POST as unknown as H)(new Request('http://localhost/api/internal/cron/expire-pending-orders', {
      method: 'POST', headers: { 'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN ?? '' },
    }) as unknown as NextRequest);
    expect(r.status, await r.clone().text()).toBe(200);
    const st = (await clone.pool.query(`SELECT id, status FROM orders.orders WHERE id = ANY($1::uuid[]) ORDER BY id`, [[oA, oB]])).rows;
    expect(st.map((x) => x.status)).toEqual(['expired', 'expired']);
    const tt = (await clone.pool.query(`SELECT id, total_qty, remaining_qty FROM catalog.ticket_types WHERE id = ANY($1::uuid[])`, [[a.ticketTypeId, b.ticketTypeId]])).rows;
    for (const t of tt) expect(t.remaining_qty).toBe(5);
    expect((await clone.pool.query(`SELECT status, order_id FROM catalog.event_seats WHERE id=$1`, [seatA])).rows[0]).toEqual({ status: 'available', order_id: null });
  });
});
