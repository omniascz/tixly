// @vitest-environment node
/**
 * Kolo 4 / krok 2 — POST /api/buyer/resale/list a /api/buyer/resale/list/[id]/cancel
 * přijímaly vlastnictví přes `ownerEmail` z těla požadavku („guest demo"). Kdo znal e-mail
 * oběti a ID vstupenky, dal cizí vstupenku do přeprodeje (a mohl ji sám levně koupit),
 * resp. stáhl cizí inzerát. UI (MyTicketsClient) volá obě routy přes authFetch (JWT).
 *
 * Očekávané: ověřená identita z middleware, nebo host s UUID SVÉ objednávky (capability
 * stránky potvrzení). Anonym s `ownerEmail` oběti → 401, žádný inzerát nevznikne / nezmizí;
 * host s UUID cizí objednávky → 401. Vlastník s JWT i host se svou objednávkou projdou.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 2 (kolo 4) — přeprodej jen s ověřenou identitou', () => {
  let clone: LocalClone;
  let fc: Awaited<ReturnType<LocalClone['seed']['fullChain']>>;
  let ticketId: string;
  let victimEmail: string;
  let ownerTok: string;

  beforeAll(async () => {
    clone = await createLocalClone();
    fc = await clone.seed.fullChain();
    ticketId = (await clone.pool.query(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [fc.orderId])).rows[0].id;
    victimEmail = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [fc.userId])).rows[0].email;
    const { signAccessToken } = await import('@/lib/auth');
    ownerTok = await signAccessToken({ id: fc.userId, email: victimEmail, name: 'V' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const post = async (url: string, mod: string, body: unknown, h: Record<string, string> = {}, params: unknown = {}) => {
    const m = (await import(/* @vite-ignore */ mod)) as unknown as Record<string, H>;
    return throughMiddleware(new Request(`http://localhost${url}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body),
    }), m.POST, params);
  };
  const listings = async () =>
    (await clone.pool.query(`SELECT count(*)::int AS n FROM resale.resale_listings WHERE ticket_id=$1 AND status='active'`, [ticketId])).rows[0].n as number;

  it('anonym s e-mailem oběti nevystaví inzerát (401, 0 inzerátů)', async () => {
    const r = await post('/api/buyer/resale/list', '@/app/api/buyer/resale/list/route', { ticketId, askPriceHalire: 100, ownerEmail: victimEmail });
    expect(r.status, await r.clone().text()).toBe(401);
    expect(await listings()).toBe(0);
  });

  it('anonym s e-mailem oběti nestáhne cizí inzerát (401, inzerát zůstane)', async () => {
    const id = (await clone.pool.query<{ id: string }>(
      `INSERT INTO resale.resale_listings (ticket_id, seller_id, ask_price, original_price, status)
       VALUES ($1,$2,5000,10000,'active') RETURNING id`, [ticketId, fc.userId])).rows[0].id;
    const r = await post(`/api/buyer/resale/list/${id}/cancel`, '@/app/api/buyer/resale/list/[id]/cancel/route',
      { ownerEmail: victimEmail }, {}, { params: { id } });
    expect(r.status, await r.clone().text()).toBe(401);
    expect(await listings()).toBe(1);
    // vlastník s JWT ho stáhnout smí
    const own = await post(`/api/buyer/resale/list/${id}/cancel`, '@/app/api/buyer/resale/list/[id]/cancel/route',
      {}, { authorization: `Bearer ${ownerTok}` }, { params: { id } });
    expect(own.status, await own.clone().text()).toBeLessThan(300);
    expect(await listings()).toBe(0);
  });

  it('vlastník s JWT projde kontrolou vlastnictví (ne 401/403)', async () => {
    const r = await post('/api/buyer/resale/list', '@/app/api/buyer/resale/list/route', { ticketId, askPriceHalire: 100 },
      { authorization: `Bearer ${ownerTok}` });
    expect([401, 403]).not.toContain(r.status);
  });

  it('host: s UUID své objednávky projde, s UUID cizí objednávky 401', async () => {
    await clone.pool.query(`DELETE FROM resale.resale_listings WHERE ticket_id=$1`, [ticketId]);
    const other = await clone.seed.fullChain();
    const bad = await post('/api/buyer/resale/list', '@/app/api/buyer/resale/list/route', { ticketId, askPriceHalire: 100, orderId: other.orderId });
    expect(bad.status, await bad.clone().text()).toBe(401);
    expect(await listings()).toBe(0);
    const ok = await post('/api/buyer/resale/list', '@/app/api/buyer/resale/list/route', { ticketId, askPriceHalire: 100, orderId: fc.orderId });
    expect([401, 403]).not.toContain(ok.status);
  });
});
