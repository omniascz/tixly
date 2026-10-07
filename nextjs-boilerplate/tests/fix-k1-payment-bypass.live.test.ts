// @vitest-environment node
/**
 * K1 — pět cest, kterými šlo získat placenou hodnotu (lístek/voucher) bez platby,
 * některé i bez přihlášení: kiosk/order, resale/buy, ticket upgrade, voucher confirm,
 * subscription holder confirm.
 *
 * Invariant (drží ať je cesta zakázaná 404, nebo správně za auth):
 *   nepřihlášený ANI cizí uživatel nezískají paid objednávku / platný lístek /
 *   dobitý voucher — stav DB se nezmění.
 *
 * Běží jen s FIX_E2E=1 (fixture nastavuje NODE_ENV=production → demo cesty vypnuté).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';

// Kolo 10: i se ZAPNUTÝM přepínačem předplatného musí demo-cesty zůstat zavřené (demo-path-guard) —
// bez toho by 404 z přepínače test splnil naprázdno.
process.env.NEXT_PUBLIC_FEATURE_SUBSCRIPTIONS = '1';

const run = describe.skipIf(!hasLocalDb);

function post(path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request(`http://localhost${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

run('K1 vstupenky/hodnota bez platby — 5 cest (izolovaná DB)', () => {
  let clone: LocalClone;
  let pool: Pool;
  let kioskPOST: (r: NextRequest) => Promise<Response>;
  let resalePOST: (r: NextRequest) => Promise<Response>;
  let upgradePOST: (r: NextRequest, ctx: { params: Promise<{ ticketId: string }> }) => Promise<Response>;
  let voucherPOST: (r: NextRequest, ctx: { params: Promise<{ paymentId: string }> }) => Promise<Response>;
  let subsPOST: (r: NextRequest, ctx: { params: Promise<{ paymentId: string }> }) => Promise<Response>;

  const paidOrdersForEvent = async (eventId: string) =>
    (await pool.query<{ n: number }>(`SELECT COUNT(*)::int n FROM orders.orders WHERE event_id=$1 AND status IN ('paid','refunded')`, [eventId])).rows[0].n;
  const remaining = async (ttId: string) => (await pool.query<{ r: number }>(`SELECT remaining_qty r FROM catalog.ticket_types WHERE id=$1`, [ttId])).rows[0].r;

  beforeAll(async () => {
    clone = await createLocalClone();
    pool = clone.pool;
    kioskPOST = (await import('@/app/api/kiosk/order/route')).POST;
    resalePOST = (await import('@/app/api/buyer/resale/buy/route')).POST;
    upgradePOST = (await import('@/app/api/buyer/tickets/[ticketId]/upgrade/route')).POST as typeof upgradePOST;
    voucherPOST = (await import('@/app/api/vouchers/holders/[paymentId]/confirm/route')).POST as typeof voucherPOST;
    subsPOST = (await import('@/app/api/subscriptions/holders/[paymentId]/confirm/route')).POST as typeof subsPOST;
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  it('kiosk/order: anon i cizí uživatel → žádná paid objednávka, kapacita beze změny', async () => {
    const c = await clone.seed.chain({ totalQty: 20, remainingQty: 20, basePrice: 50000 });
    const slug = (await pool.query<{ s: string }>(`SELECT slug s FROM platform.promoters WHERE id=$1`, [c.promoterId])).rows[0].s;
    const foreign = await clone.seed.user('foreign', 'Cizí');
    const remBefore = await remaining(c.ticketTypeId);
    const body = { promoterSlug: slug, eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 2, buyerEmail: `att-${randomUUID().slice(0, 6)}@x.test`, buyerName: 'Útočník' };

    const anon = await kioskPOST(post('/api/kiosk/order', body));
    expect(anon.status, 'anon nesmí dostat 200').not.toBe(200);
    const foreignRes = await kioskPOST(post('/api/kiosk/order', body, { 'x-user-id': foreign.id }));
    expect([401, 403]).toContain(foreignRes.status);

    expect(await paidOrdersForEvent(c.eventId), 'žádná paid objednávka').toBe(0);
    expect(await remaining(c.ticketTypeId), 'kapacita beze změny').toBe(remBefore);
  });

  it('resale/buy: anon → žádná paid objednávka (cesta vypnutá)', async () => {
    const listingId = randomUUID();
    const paidBefore = (await pool.query<{ n: number }>(`SELECT COUNT(*)::int n FROM orders.orders WHERE status='paid'`)).rows[0].n;
    const r = await resalePOST(post('/api/buyer/resale/buy', { listingId, buyerEmail: `rb-${randomUUID().slice(0, 6)}@x.test` }));
    expect(r.status, 'anon resale/buy nesmí uspět (cesta vypnutá → 404)').toBe(404);
    const paidAfter = (await pool.query<{ n: number }>(`SELECT COUNT(*)::int n FROM orders.orders WHERE status='paid'`)).rows[0].n;
    expect(paidAfter, 'nevznikla žádná nová paid objednávka').toBe(paidBefore);
  });

  it('ticket upgrade: anon i cizí ownerEmail → typ lístku beze změny', async () => {
    const fc = await clone.seed.fullChain({ totalQty: 20, remainingQty: 18, basePrice: 50000 });
    const ticketId = (await pool.query<{ id: string; tt: string }>(`SELECT id, ticket_type_id tt FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [fc.orderId])).rows[0].id;
    const vip = randomUUID();
    await pool.query(`INSERT INTO catalog.ticket_types (id, event_id, name, kind, base_price, total_qty, remaining_qty, visibility)
                      VALUES ($1,$2,'VIP','standing',100000,10,10,'public')`, [vip, fc.eventId]);
    const ttBefore = (await pool.query<{ tt: string }>(`SELECT ticket_type_id tt FROM tickets.tickets WHERE id=$1`, [ticketId])).rows[0].tt;
    // Skutečná K1 vada: i nepřihlášený, který zná JEN e-mail vlastníka + ticketId,
    // upgradne lístek bez zaplacení rozdílu. Testujeme přímo tuhle cestu.
    const ownerEmail = fc.email;
    const anon = await upgradePOST(post(`/api/buyer/tickets/${ticketId}/upgrade`, { targetTicketTypeId: vip, ownerEmail }), { params: Promise.resolve({ ticketId }) });
    expect(anon.status, 'upgrade bez platby (jen ownerEmail) nesmí uspět').not.toBe(200);
    const foreign = await upgradePOST(post(`/api/buyer/tickets/${ticketId}/upgrade`, { targetTicketTypeId: vip, ownerEmail: `cizi-${randomUUID().slice(0, 6)}@x.test` }), { params: Promise.resolve({ ticketId }) });
    expect(foreign.status).not.toBe(200);
    const ttAfter = (await pool.query<{ tt: string }>(`SELECT ticket_type_id tt FROM tickets.tickets WHERE id=$1`, [ticketId])).rows[0].tt;
    expect(ttAfter, 'typ lístku se nezměnil').toBe(ttBefore);
  });

  it('voucher confirm: anon → voucher zůstává pending, bez zůstatku', async () => {
    const pid = randomUUID();
    const issuer = await clone.seed.user('voucherbuyer', 'Voucher Buyer');
    await pool.query(`INSERT INTO marketing.gift_vouchers (id, code, amount_halire, balance_halire, payment_status, payment_id, issued_by_user)
                      VALUES (gen_random_uuid(), $1, 200000, 0, 'pending', $2, $3)`, [`GV${Date.now().toString(36)}`, pid, issuer.id]);
    const r = await voucherPOST(post(`/api/vouchers/holders/${pid}/confirm`, { action: 'pay' }), { params: Promise.resolve({ paymentId: pid }) });
    expect(r.status, 'anon voucher confirm nesmí uspět').not.toBe(200);
    const v = (await pool.query<{ ps: string; b: number }>(`SELECT payment_status ps, balance_halire b FROM marketing.gift_vouchers WHERE payment_id=$1`, [pid])).rows[0];
    expect(v.ps, 'voucher zůstal pending').toBe('pending');
    expect(Number(v.b), 'žádný dobitý zůstatek').toBe(0);
  });

  it('subscription confirm: anon → holder zůstává pending, žádné vstupenky', async () => {
    const c = await clone.seed.chain({ totalQty: 20, remainingQty: 20, basePrice: 30000 });
    const pkgId = randomUUID();
    await pool.query(`INSERT INTO subscriptions.packages (id, promoter_id, name, slug, season_label, base_price_halire, abo_type, status)
                      VALUES ($1,$2,'Abo K1',$3,'25/26',300000,'fixed','on_sale')`, [pkgId, c.promoterId, `abo-k1-${Date.now().toString(36)}`]);
    await pool.query(`INSERT INTO subscriptions.package_events (package_id, event_id, order_index) VALUES ($1,$2,0)`, [pkgId, c.eventId]);
    const pid = randomUUID();
    const buyer = await clone.seed.user('subbuyer', 'Sub Buyer');
    await pool.query(`INSERT INTO subscriptions.holders (id, package_id, user_id, holder_name, holder_email, valid_until, price_paid_halire, currency, status, payment_status, payment_id, payment_provider)
                      VALUES (gen_random_uuid(),$1,$2,'Sub Buyer',$3, now()+interval '1 year', 300000,'CZK','pending_payment','pending',$4,'mock')`,
                      [pkgId, buyer.id, buyer.email, pid]);
    const r = await subsPOST(post(`/api/subscriptions/holders/${pid}/confirm`, { action: 'pay' }), { params: Promise.resolve({ paymentId: pid }) });
    expect(r.status, 'anon subscription confirm nesmí uspět').not.toBe(200);
    const h = (await pool.query<{ ps: string; id: string }>(`SELECT payment_status ps, id FROM subscriptions.holders WHERE payment_id=$1`, [pid])).rows[0];
    expect(h.ps, 'holder zůstal pending').toBe('pending');
    const red = (await pool.query<{ n: number }>(`SELECT COUNT(*)::int n FROM subscriptions.redemptions WHERE holder_id=$1`, [h.id])).rows[0].n;
    expect(red, 'žádné vydané vstupenky').toBe(0);
  });
});
