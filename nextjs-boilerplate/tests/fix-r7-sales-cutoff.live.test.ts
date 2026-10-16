// @vitest-environment node
/**
 * Kolo 7 / krok 1 — uzávěrka prodeje (C-29). Checkout dřív `date_start` vůbec nekontroloval:
 * vstupenky šly koupit i na proběhlou akci (TESTING_MAP.md:357).
 *
 * Očekávané (lib/sales/cutoff.ts):
 *   - online (kupec): do `sales_end_at`, jinak do `date_start`; po uzávěrce 409 SALES_CLOSED na
 *     checkoutu, mobilní platbě, držení sedadla, kiosku a všech ostatních kupcových cestách
 *     (strukturální inventura níže);
 *   - pokladna (POS) prodává do `date_end`, jinak `date_start + 12 h`;
 *   - objednávku založenou před uzávěrkou lze doplatit (webhook PAID → paid);
 *   - editace akce: `salesEndAt` po konci akce → 422.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;
const GOPAY = process.env.FIX_GOPAY_URL ?? 'http://localhost:3998';
const API = path.resolve(__dirname, '../src/app/api');

/** Cesty, kde objednávku (nebo držení) zakládá kupec → musí kontrolovat online uzávěrku. */
const BUYER_PATHS = [
  'checkout/route.ts',
  'checkout/party-split/[token]/route.ts',
  'mobile/payment-intent/route.ts',
  'events/[id]/seats/hold/route.ts',
  'kiosk/order/route.ts',
  'buyer/group-invitations/[token]/claim/route.ts',
  'buyer/modular-pass/checkout/route.ts',
  'buyer/subscriptions/[id]/pick/route.ts',
  'buyer/tickets/[ticketId]/exchange/route.ts',
  'charity/claim/[token]/route.ts',
  'resale/purchase/[listingId]/route.ts',
  'season-passes/[passToken]/route.ts',
  'v1/wl/orders/route.ts',
];
/** Prodej obsluhou na místě → do konce akce. */
const BOX_OFFICE_PATHS = [
  'admin/pos/sale/route.ts',
  'admin/events/[id]/box-office/sell/route.ts',
  'reseller/sale/route.ts',
  'partner/sales/route.ts',
];

describe('Kolo 7 — inventura: každá cesta prodeje kontroluje uzávěrku', () => {
  it('kupcové cesty volají saleBlockedResponse(…, online), pokladní (…, box_office)', () => {
    const bad: string[] = [];
    for (const f of BUYER_PATHS) {
      if (!/saleBlockedResponse\([^;]*?'online'\)/.test(readFileSync(path.join(API, f), 'utf8'))) bad.push(`${f} (online)`);
    }
    for (const f of BOX_OFFICE_PATHS) {
      if (!/saleBlockedResponse\([^;]*?'box_office'\)/.test(readFileSync(path.join(API, f), 'utf8'))) bad.push(`${f} (box_office)`);
    }
    expect(bad).toEqual([]);
  });
});

run('Kolo 7 — uzávěrka prodeje za běhu', () => {
  let clone: LocalClone;
  let c: Awaited<ReturnType<LocalClone['seed']['chain']>>;
  let staffTok: string;
  let buyerTok: string;

  const setTimes = (start: string, end: string | null, salesEnd: string | null = null) =>
    clone.pool.query(
      `UPDATE catalog.events SET date_start = NOW() + $2::interval,
              date_end = CASE WHEN $3::text IS NULL THEN NULL ELSE NOW() + $3::interval END,
              sales_end_at = CASE WHEN $4::text IS NULL THEN NULL ELSE NOW() + $4::interval END
        WHERE id = $1`, [c.eventId, start, end, salesEnd]);

  beforeAll(async () => {
    clone = await createLocalClone();
    c = await clone.seed.chain({ totalQty: 100, remainingQty: 100, basePrice: 20000 });
    await clone.pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [c.promoterId]);
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [c.adminUserId])).rows[0].email;
    staffTok = await signAccessToken({ id: c.adminUserId, email, name: 'S' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: c.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
    } as never);
    const u = await clone.seed.user('cut', 'Kupec');
    buyerTok = await signAccessToken({ id: u.id, email: u.email, name: 'K' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const call = async (url: string, mod: () => Promise<{ POST?: unknown; PATCH?: unknown }>, body: unknown, tok?: string, ctx: unknown = {}, method = 'POST') => {
    const m = await mod();
    const h = (method === 'PATCH' ? m.PATCH : m.POST) as H;
    const r = await throughMiddleware(new Request(`http://localhost${url}`, {
      method,
      headers: { 'content-type': 'application/json', origin: 'http://localhost', 'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 250) + 1}`, ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      body: JSON.stringify(body),
    }), h, ctx);
    return { status: r.status, body: await r.text() };
  };
  const checkout = (qty = 1) => call('/api/checkout', () => import('@/app/api/checkout/route'),
    { eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: qty, buyerEmail: `cut-${randomUUID().slice(0, 8)}@fix.test`, buyerName: 'Kupec' });
  const pos = () => call('/api/admin/pos/sale', () => import('@/app/api/admin/pos/sale/route'),
    { eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 1, paymentMethod: 'cash' }, staffTok);

  it('před uzávěrkou: checkout projde', async () => {
    await setTimes('7 days', '7 days 3 hours');
    const r = await checkout();
    expect(r.status, r.body).toBe(200);
  });

  it('po začátku akce (sales_end_at nenastaven): checkout, mobilní platba, držení sedadla a kiosk → 409 SALES_CLOSED', async () => {
    await setTimes('-1 hour', '2 hours');
    const seatId = (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, status) VALUES ($1,$2,'P','A','9','available') RETURNING id`,
      [c.eventId, c.ticketTypeId])).rows[0].id;
    const results = {
      checkout: await checkout(),
      // zástupná hodnota — routa kontroluje jen přítomnost; 409 přijde dřív, než by se volal Stripe
      paymentIntent: await (async () => {
        const prev = process.env.STRIPE_SECRET_KEY;
        process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_r7';
        try {
          return await call('/api/mobile/payment-intent', () => import('@/app/api/mobile/payment-intent/route'),
            { eventId: c.eventId, ticketTypeId: c.ticketTypeId, qty: 1 }, buyerTok);
        } finally {
          if (prev === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = prev;
        }
      })(),
      seatHold: await call(`/api/events/${c.eventId}/seats/hold`, () => import('@/app/api/events/[id]/seats/hold/route'),
        { seatIds: [seatId] }, buyerTok, { params: { id: c.eventId } }),
      kiosk: await call('/api/kiosk/order', () => import('@/app/api/kiosk/order/route'),
        { promoterSlug: 'x', eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 1 }, staffTok),
    };
    for (const [k, r] of Object.entries(results)) {
      expect(r.status, `${k}: ${r.body}`).toBe(409);
      expect(r.body, k).toMatch(/SALES_CLOSED/);
    }
    expect((await clone.pool.query(`SELECT status FROM catalog.event_seats WHERE id=$1`, [seatId])).rows[0].status).toBe('available');
  });

  it('uzávěrka nastavená pořadatelem (před začátkem akce) platí: checkout → 409', async () => {
    await setTimes('2 days', '2 days 3 hours', '-10 minutes');
    const r = await checkout();
    expect(r.status, r.body).toBe(409);
  });

  it('POS: po začátku akce projde, po konci akce (date_end) ne, bez date_end do začátku + 12 h', async () => {
    await setTimes('-1 hour', '2 hours');
    const during = await pos();
    expect(during.status, during.body).toBe(200);
    await setTimes('-5 hours', '-1 hour');
    const after = await pos();
    expect(after.status, after.body).toBe(409);
    await setTimes('-11 hours', null);
    expect((await pos()).status, 'bez date_end: 11 h po začátku ještě prodává').toBe(200);
    await setTimes('-13 hours', null);
    expect((await pos()).status, 'bez date_end: 13 h po začátku už ne').toBe(409);
  });

  it('objednávku založenou před uzávěrkou lze po uzávěrce doplatit (webhook PAID → paid)', async () => {
    await setTimes('3 days', '3 days 3 hours');
    const co = await checkout();
    expect(co.status, co.body).toBe(200);
    const { orderId, paymentId } = JSON.parse(co.body) as { orderId: string; paymentId: string };
    await setTimes('-30 minutes', '3 hours');
    await fetch(`${GOPAY}/_ctl/${paymentId}`, { method: 'POST', body: JSON.stringify({ state: 'PAID' }) });
    const { GET } = await import('@/app/api/payments/gopay/webhook/route');
    const wh = await GET(new Request(`http://localhost/api/payments/gopay/webhook?id=${paymentId}`) as unknown as NextRequest);
    expect(wh.status).toBe(200);
    expect((await clone.pool.query(`SELECT status FROM orders.orders WHERE id=$1`, [orderId])).rows[0].status).toBe('paid');
  });

  it('editace akce: salesEndAt po konci akce → 422, platná hodnota se uloží', async () => {
    await setTimes('10 days', '10 days 3 hours');
    const dates = (await clone.pool.query<{ ds: Date; de: Date }>(`SELECT date_start ds, date_end de FROM catalog.events WHERE id=$1`, [c.eventId])).rows[0];
    const patch = (salesEndAt: string) => call(`/api/admin/events/${c.eventId}`, () => import('@/app/api/admin/events/[id]/route'),
      { salesEndAt }, staffTok, { params: { id: c.eventId } }, 'PATCH');
    const bad = await patch(new Date(dates.de.getTime() + 3600_000).toISOString());
    expect(bad.status, bad.body).toBe(422);
    const okVal = new Date(dates.ds.getTime() - 3600_000).toISOString();
    const ok = await patch(okVal);
    expect(ok.status, ok.body).toBe(200);
    const stored = (await clone.pool.query<{ s: Date }>(`SELECT sales_end_at s FROM catalog.events WHERE id=$1`, [c.eventId])).rows[0].s;
    expect(stored.toISOString()).toBe(okVal);
  });
});
