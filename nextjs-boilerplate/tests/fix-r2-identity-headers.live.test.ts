// @vitest-environment node
/**
 * Kolo 2 / krok 0 — podvržené identitní a role hlavičky.
 *
 * Invariant: identita/role smí do handleru dorazit VÝHRADNĚ z ověřené session (JWT),
 * nikdy z hlavičky, kterou poslal klient. Middleware proto musí příchozí identitní
 * hlavičky zahodit na KAŽDÉ API cestě (i public / pass-through / optional-auth bez tokenu).
 *
 * Všechny požadavky jdou přes skutečný `src/middleware.ts` (helpers/through-middleware),
 * ne napřímo do handleru — jinak by test obešel právě testovanou vrstvu.
 *
 * Běží jen s FIX_E2E=1 (izolovaná DB z migrací, aplikace pod tixly_app).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { runMiddleware, throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);

/** Identitní / role hlavičky, které API čte (inventura `grep "x-…"` v src/, kolo 2). */
const FORGED = (victimId: string): Record<string, string> => ({
  'x-user-id': victimId,
  'x-is-admin': 'true',
  'x-is-platform-admin': 'true',
  'x-vercel-cron': '1',
});

function req(method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

run('Krok 0 — podvržené identitní hlavičky (přes skutečný middleware)', () => {
  let clone: LocalClone;
  let pool: Pool;

  beforeAll(async () => {
    clone = await createLocalClone();
    pool = clone.pool;
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  it('nepřihlášený POST /api/kiosk/order s x-user-id EXISTUJÍCÍ obsluhy → 401, žádná objednávka', async () => {
    const c = await clone.seed.chain({ totalQty: 20, remainingQty: 20, basePrice: 50000 });
    // c.adminUserId je skutečný člen (owner) promotéra akce = legitimní obsluha pokladny
    const slug = (await pool.query<{ s: string }>(`SELECT slug s FROM platform.promoters WHERE id=$1`, [c.promoterId])).rows[0].s;
    const buyerEmail = `kiosk-forged-${randomUUID().slice(0, 8)}@x.test`;
    const { POST } = await import('@/app/api/kiosk/order/route');

    const res = await throughMiddleware(
      req('POST', '/api/kiosk/order', FORGED(c.adminUserId),
        { promoterSlug: slug, eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 2, buyerEmail, buyerName: 'Útočník' }),
      POST as (r: NextRequest) => Promise<Response>,
    );
    expect(res.status).toBe(401);
    const orders = await pool.query(
      `SELECT o.id FROM orders.orders o JOIN identity.users u ON u.id=o.user_id WHERE lower(u.email)=lower($1)`, [buyerEmail]);
    expect(orders.rowCount, 'žádná objednávka pro útočníkův e-mail').toBe(0);
    const rem = (await pool.query<{ r: number }>(`SELECT remaining_qty r FROM catalog.ticket_types WHERE id=$1`, [c.ticketTypeId])).rows[0].r;
    expect(rem, 'kapacita beze změny').toBe(20);
  });

  // Každá větev middlewaru, která požadavek PROPUSTÍ bez ověřeného tokenu.
  const passThroughCases: Array<[string, string, Record<string, string>]> = [
    ['auth', '/api/auth/login', {}],
    ['public prefix', '/api/internal/order-completed', {}],
    ['public GET', '/api/events/abc/ticket-types', {}],
    ['mimo seznamy (pass-through)', '/api/cron/resale-payouts', {}],
    ['optional-auth bez tokenu', '/api/checkout', {}],
    ['optional-auth s neplatným tokenem', '/api/buyer/orders', { authorization: 'Bearer not-a-jwt' }],
  ];
  for (const [label, path, extra] of passThroughCases) {
    it(`middleware zahodí všechny identitní hlavičky: ${label} (${path})`, async () => {
      const victim = randomUUID();
      const method = label === 'public GET' || label.startsWith('mimo') || label.includes('neplatným') ? 'GET' : 'POST';
      const { blocked, forwardedHeaders } = await runMiddleware(req(method, path, { ...FORGED(victim), ...extra }, method === 'GET' ? undefined : {}));
      expect(blocked, 'tahle cesta se má propustit (testujeme právě propuštěné)').toBeNull();
      for (const h of Object.keys(FORGED(victim))) {
        expect(forwardedHeaders!.get(h), `${h} nesmí do handleru dorazit z klienta`).toBeNull();
      }
    });
  }

  it('přihlášený uživatel s podvrženým x-user-id cizího uživatele → handler dostane JEN identitu z JWT', async () => {
    const me = await clone.seed.user('me', 'Já');
    const victim = await clone.seed.user('victim', 'Oběť');
    const { signAccessToken } = await import('@/lib/auth');
    const token = await signAccessToken({ id: me.id, email: me.email, name: 'Já' } as never, { isPlatformAdmin: false, promoterMemberships: [] });
    for (const path of ['/api/buyer/orders', '/api/admin/events']) {
      const { blocked, forwardedHeaders } = await runMiddleware(req('GET', path, { ...FORGED(victim.id), authorization: `Bearer ${token}` }));
      if (path.startsWith('/api/admin/')) {
        // kupující bez membership → 403 už v middlewaru, podvržené x-is-admin nepomůže
        expect(blocked?.status).toBe(403);
        continue;
      }
      expect(blocked).toBeNull();
      expect(forwardedHeaders!.get('x-user-id')).toBe(me.id);
      expect(forwardedHeaders!.get('x-is-platform-admin')).toBeNull();
      expect(forwardedHeaders!.get('x-vercel-cron')).toBeNull();
    }
  });

  it('admin/gift-cards: platform admin z JWT projde, promotér a podvržená hlavička ne', async () => {
    const { GET } = await import('@/app/api/admin/gift-cards/route');
    const h = GET as (r: NextRequest) => Promise<Response>;
    const { signAccessToken } = await import('@/lib/auth');
    const adm = await clone.seed.user('padm', 'Admin');
    const c = await clone.seed.chain();
    const admTok = await signAccessToken({ id: adm.id, email: adm.email, name: 'A' } as never, { isPlatformAdmin: true, promoterMemberships: [] });
    const proTok = await signAccessToken({ id: c.adminUserId, email: 'p@x.test', name: 'P' } as never,
      { isPlatformAdmin: false, promoterMemberships: [{ promoterId: c.promoterId, status: 'active', role: 'owner' } as never] });
    expect((await throughMiddleware(req('GET', '/api/admin/gift-cards', { authorization: `Bearer ${admTok}` }), h)).status).toBe(200);
    expect((await throughMiddleware(req('GET', '/api/admin/gift-cards', { authorization: `Bearer ${proTok}`, 'x-is-platform-admin': 'true', 'x-is-admin': 'true' }), h)).status).toBe(403);
    expect((await throughMiddleware(req('GET', '/api/admin/gift-cards', { 'x-is-platform-admin': 'true', 'x-is-admin': 'true' }), h)).status).toBe(401);
  });

  it('cron routy: podvržené x-vercel-cron bez tajemství → 401 a výplata zůstane nezaplacená', async () => {
    const fc = await clone.seed.fullChain({ totalQty: 10, remainingQty: 9, basePrice: 50000 });
    const ticketId = (await pool.query<{ id: string }>(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [fc.orderId])).rows[0].id;
    const listingId = (await pool.query<{ id: string }>(
      `INSERT INTO resale.resale_listings (ticket_id, seller_id, buyer_id, ask_price, original_price, status, sold_at)
       VALUES ($1, $2, $2, 50000, 50000, 'sold', now()) RETURNING id`, [ticketId, fc.userId])).rows[0].id;
    const payoutId = (await pool.query<{ id: string }>(
      `INSERT INTO resale.seller_payouts (listing_id, seller_id, sale_price_halire, resale_fee_halire, payout_halire, bank_iban, status, scheduled_for)
       VALUES ($1, $2, 50000, 2500, 47500, 'CZ6508000000192000145399', 'eligible', now() - interval '1 day') RETURNING id`,
      [listingId, fc.userId])).rows[0].id;

    const routes: Array<[string, string]> = [
      ['/api/cron/resale-payouts', '@/app/api/cron/resale-payouts/route'],
      ['/api/cron/pricing-engine', '@/app/api/cron/pricing-engine/route'],
      ['/api/cron/inventory-refresh', '@/app/api/cron/inventory-refresh/route'],
    ];
    for (const [path, mod] of routes) {
      const { GET } = await import(/* @vite-ignore */ mod);
      const res = await throughMiddleware(req('GET', path, { 'x-vercel-cron': '1' }), GET as (r: NextRequest) => Promise<Response>);
      expect(res.status, `${path}: podvržené x-vercel-cron`).toBe(401);
    }
    const st = (await pool.query<{ status: string }>(`SELECT status FROM resale.seller_payouts WHERE id=$1`, [payoutId])).rows[0].status;
    expect(st, 'výplata nesmí být označena jako zaplacená').toBe('eligible');

    // legitimní volání se skutečným tajemstvím dál funguje
    const { GET } = await import('@/app/api/cron/resale-payouts/route');
    const ok = await throughMiddleware(req('GET', '/api/cron/resale-payouts', { 'x-cron-secret': process.env.CRON_SECRET! }), GET as (r: NextRequest) => Promise<Response>);
    expect(ok.status).toBe(200);
    const st2 = (await pool.query<{ status: string }>(`SELECT status FROM resale.seller_payouts WHERE id=$1`, [payoutId])).rows[0].status;
    expect(st2).toBe('paid');
  });
});
