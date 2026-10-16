// @vitest-environment node
/**
 * K3 — kapacitu lze trvale zablokovat nezaplacenými rezervacemi.
 * Regresní testy proti IZOLOVANÉ DB + fake-gopay (bez mocků platebního toku):
 *   1) expirace pending objednávek vrátí GA kapacitu i promo max_uses (cron už nepadá 42703),
 *   2) zrušená platba (webhook CANCELED) objednávku zruší a kapacitu okamžitě vrátí,
 *   3) rate limit vytváření objednávek: 10/10min per IP → 429; 5 souběžných nezaplacených per e-mail → blok.
 *
 * Běží jen s FIX_E2E=1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';

const run = describe.skipIf(!hasLocalDb);
const GOPAY = process.env.FIX_GOPAY_URL ?? 'http://localhost:3998';
const TOKEN = 'fix-internal-token-0123456789abcdef';

function reqJSON(method: string, path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}
const ctl = (id: string, body: unknown) => fetch(`${GOPAY}/_ctl/${id}`, { method: 'POST', body: JSON.stringify(body) });

run('K3 kapacita — expirace, zrušená platba, rate limit (izolovaná DB)', () => {
  let clone: LocalClone;
  let pool: Pool;
  let checkoutPOST: (r: NextRequest) => Promise<Response>;
  let webhookGET: (r: NextRequest) => Promise<Response>;
  let expirePOST: (r: NextRequest) => Promise<Response>;

  async function checkout(opts: { eventId: string; ttId: string; qty?: number; email?: string; ip?: string; promo?: string }) {
    const ip = opts.ip ?? `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
    const r = await checkoutPOST(reqJSON('POST', '/api/checkout', {
      eventId: opts.eventId, ticketTypeId: opts.ttId, quantity: opts.qty ?? 1,
      buyerEmail: opts.email ?? `k3-${randomUUID().slice(0, 8)}@tixly.test`, buyerName: 'K3 Buyer',
      ...(opts.promo ? { promoCode: opts.promo } : {}),
    }, { 'x-forwarded-for': ip, 'x-real-ip': ip }));
    const j = await r.clone().json().catch(() => ({}));
    return { status: r.status, orderId: j.orderId as string | undefined, paymentId: j.paymentId as string | undefined };
  }
  const remaining = async (ttId: string) => (await pool.query<{ r: number }>(`SELECT remaining_qty r FROM catalog.ticket_types WHERE id=$1`, [ttId])).rows[0].r;
  const orderStatus = async (id: string) => (await pool.query<{ s: string }>(`SELECT status s FROM orders.orders WHERE id=$1`, [id])).rows[0]?.s;

  beforeAll(async () => {
    clone = await createLocalClone();
    pool = clone.pool;
    checkoutPOST = (await import('@/app/api/checkout/route')).POST;
    webhookGET = (await import('@/app/api/payments/gopay/webhook/route')).GET;
    expirePOST = (await import('@/app/api/internal/cron/expire-pending-orders/route')).POST;
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  it('1) expirace vrátí GA kapacitu i promo uses_count; cron nepadá na 42703', async () => {
    const c = await clone.seed.chain({ totalQty: 100, remainingQty: 100, basePrice: 10000 });
    const code = `K3PROMO${Date.now().toString(36).toUpperCase()}`;
    await pool.query(
      `INSERT INTO marketing.promo_codes (id, code, type, discount_value, max_uses, uses_count, active, valid_from, valid_until, created_by_organizer_id)
       VALUES (gen_random_uuid(), $1, 'percentage', 10, 100, 0, TRUE, now()-interval '1 day', now()+interval '30 days', $2)`, [code, c.promoterId]);

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const co = await checkout({ eventId: c.eventId, ttId: c.ticketTypeId, qty: 2, promo: code });
      expect(co.status, 'checkout s promo projde').toBe(200);
      ids.push(co.orderId!);
    }
    expect(await remaining(c.ticketTypeId)).toBe(94); // 100 - 3*2
    const usesAfterBuy = (await pool.query<{ u: number }>(`SELECT uses_count u FROM marketing.promo_codes WHERE code=$1`, [code])).rows[0].u;
    expect(usesAfterBuy).toBe(3);

    // vyprší
    await pool.query(`UPDATE orders.orders SET expires_at = now() - interval '2 minutes' WHERE id = ANY($1::uuid[])`, [ids]);
    const cron = await expirePOST(reqJSON('POST', '/api/internal/cron/expire-pending-orders', {}, { 'x-internal-token': TOKEN }));
    // PŘED opravou: 500 (column "event_seat_id" does not exist). PO opravě: 200.
    expect(cron.status, await cron.clone().text()).toBe(200);

    expect(await remaining(c.ticketTypeId), 'GA kapacita zpět').toBe(100);
    const usesAfterExpire = (await pool.query<{ u: number }>(`SELECT uses_count u FROM marketing.promo_codes WHERE code=$1`, [code])).rows[0].u;
    expect(usesAfterExpire, 'promo max_uses uvolněno').toBe(0);
    for (const id of ids) expect(await orderStatus(id)).toBe('expired');
  });

  it('1b) expirace uvolní i SEDADLA (prošlý hold → available)', async () => {
    const c = await clone.seed.chain({ totalQty: 10, remainingQty: 10, basePrice: 10000, kind: 'seated' });
    const seatId = randomUUID();
    await pool.query(
      `INSERT INTO catalog.event_seats (id, event_id, ticket_type_id, sector, row, seat_number, status, hold_until)
       VALUES ($1, $2, $3, 'A', '1', '1', 'held', now() - interval '2 minutes')`,
      [seatId, c.eventId, c.ticketTypeId]);
    const cron = await expirePOST(reqJSON('POST', '/api/internal/cron/expire-pending-orders', {}, { 'x-internal-token': TOKEN }));
    expect(cron.status).toBe(200);
    const st = (await pool.query<{ s: string }>(`SELECT status s FROM catalog.event_seats WHERE id=$1`, [seatId])).rows[0].s;
    expect(st, 'prošlý seat hold uvolněn na available').toBe('available');
  });

  it('2) zrušená platba (webhook CANCELED) → objednávka cancelled a kapacita hned zpět', async () => {
    const c = await clone.seed.chain({ totalQty: 50, remainingQty: 50, basePrice: 10000 });
    const co = await checkout({ eventId: c.eventId, ttId: c.ticketTypeId, qty: 2 });
    expect(co.status).toBe(200);
    expect(await remaining(c.ticketTypeId)).toBe(48);

    await ctl(co.paymentId!, { state: 'CANCELED' });
    const wh = await webhookGET(reqJSON('GET', `/api/payments/gopay/webhook?id=${co.paymentId}`, undefined));
    expect(wh.status).toBe(200);

    expect(await orderStatus(co.orderId!)).toBe('cancelled');
    expect(await remaining(c.ticketTypeId), 'kapacita po zrušení platby zpět').toBe(50);
  });

  it('3a) rate limit: 10 objednávek/10min z jedné IP OK, 11. → 429', async () => {
    const c = await clone.seed.chain({ totalQty: 1000, remainingQty: 1000, basePrice: 10000 });
    const ip = '203.0.113.10';
    let ok = 0; let limited = 0;
    for (let i = 0; i < 12; i++) {
      const co = await checkout({ eventId: c.eventId, ttId: c.ticketTypeId, qty: 1, ip, email: `rl-ip-${i}@tixly.test` });
      if (co.status === 200) ok++; else if (co.status === 429) limited++;
    }
    expect(ok, '≤10 projde').toBeLessThanOrEqual(10);
    expect(limited, '≥1 zamítnuto 429').toBeGreaterThanOrEqual(1);
  });

  it('3b) rate limit: 5 souběžných nezaplacených na jeden e-mail, 6. → 429', async () => {
    const c = await clone.seed.chain({ totalQty: 1000, remainingQty: 1000, basePrice: 10000 });
    const email = `rl-mail-${randomUUID().slice(0, 8)}@tixly.test`;
    let ok = 0; let limited = 0;
    for (let i = 0; i < 7; i++) {
      const co = await checkout({ eventId: c.eventId, ttId: c.ticketTypeId, qty: 1, email, ip: `203.0.113.${20 + i}` });
      if (co.status === 200) ok++; else if (co.status === 429) limited++;
    }
    expect(ok, '≤5 nezaplacených projde').toBeLessThanOrEqual(5);
    expect(limited, '≥1 zamítnuto 429').toBeGreaterThanOrEqual(1);
  });
});
