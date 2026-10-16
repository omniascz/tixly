// @vitest-environment node
/**
 * Kolo 4 / krok 3g — mobilní appka kupce (mobile/app/orders/index.tsx) volá
 * GET /api/v1/buyer/orders, který neexistoval (404) — seznam objednávek v appce byl vždy chyba.
 * Očekávané: přihlášený kupec (Bearer) dostane SVOJE objednávky ve tvaru, který appka čte
 * ({ orders: [{ id, status, totalAmount, currency, createdAt, eventTitle, eventDate, itemCount }] }),
 * cizí objednávky ne; bez přihlášení 401.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 3g (kolo 4) — GET /api/v1/buyer/orders pro mobilní appku', () => {
  let clone: LocalClone;
  let mine: Awaited<ReturnType<LocalClone['seed']['fullChain']>>;
  let foreign: Awaited<ReturnType<LocalClone['seed']['fullChain']>>;
  let tok: string;

  beforeAll(async () => {
    clone = await createLocalClone();
    mine = await clone.seed.fullChain();
    foreign = await clone.seed.fullChain();
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [mine.userId])).rows[0].email;
    const { signAccessToken } = await import('@/lib/auth');
    tok = await signAccessToken({ id: mine.userId, email, name: 'M' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const call = async (h: Record<string, string>) => {
    const mod = (await import('@/app/api/v1/buyer/orders/route')) as unknown as Record<string, H>;
    const r = await throughMiddleware(new Request('http://localhost/api/v1/buyer/orders', { headers: h }), mod.GET, {});
    return { status: r.status, body: await r.text() };
  };

  it('kupec dostane svoje objednávky ve tvaru appky, cizí ne', async () => {
    const r = await call({ authorization: `Bearer ${tok}` });
    expect(r.status, r.body).toBe(200);
    const j = JSON.parse(r.body) as { orders: Record<string, unknown>[] };
    expect(j.orders.map((o) => o.id)).toEqual([mine.orderId]);
    expect(j.orders[0]).toMatchObject({ status: 'paid', totalAmount: 10000, currency: 'CZK', eventTitle: 'Test Akce', itemCount: 1 });
    expect(typeof j.orders[0].createdAt).toBe('string');
    expect(typeof j.orders[0].eventDate).toBe('string');
    expect(r.body).not.toContain(foreign.orderId);
  });

  it('bez přihlášení 401', async () => {
    expect((await call({})).status).toBe(401);
  });
});
