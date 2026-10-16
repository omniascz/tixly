// @vitest-environment node
/**
 * Kolo 5 / integrace — POST /api/admin/orders/[orderId]/send-tickets (kód vlastníka) běžel v
 * `runAsPromoter`, který pustí i POZASTAVENÉHO pořadatele. Routa rozesílá vstupenky kupce (QR)
 * a s `toOverride` i na libovolnou adresu → pozastavený pořadatel mohl vstupenky vyvést.
 *
 * Očekávané: jako ostatní zápisové akce (comps, guestlist, holds) jen aktivní pořadatel —
 * pozastavený 401 a žádný e-mail; aktivní 200 a e-mail dorazí.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, mailpitLatest, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Kolo 5 — send-tickets jen pro aktivního pořadatele', () => {
  let clone: LocalClone;
  let fc: Awaited<ReturnType<LocalClone['seed']['fullChain']>>;
  let tok: string;

  beforeAll(async () => {
    clone = await createLocalClone();
    fc = await clone.seed.fullChain();
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [fc.adminUserId])).rows[0].email;
    const { signAccessToken } = await import('@/lib/auth');
    tok = await signAccessToken({ id: fc.adminUserId, email, name: 'S' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: fc.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
    } as never);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const send = async (to: string) => {
    const { POST } = await import('@/app/api/admin/orders/[orderId]/send-tickets/route');
    const r = await throughMiddleware(new Request(`http://localhost/api/admin/orders/${fc.orderId}/send-tickets`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ toOverride: to }),
    }), POST as unknown as H, { params: { orderId: fc.orderId } });
    return { status: r.status, body: await r.text() };
  };

  it('pozastavený pořadatel: 401, na podvrženou adresu nic neodejde', async () => {
    await clone.pool.query(`UPDATE platform.promoters SET status='suspended' WHERE id=$1`, [fc.promoterId]);
    const to = `vyvoz-${Date.now()}@fix.test`;
    const r = await send(to);
    expect(r.status, r.body).toBe(401);
    await new Promise((res) => setTimeout(res, 1500));
    expect(await mailpitLatest(to)).toBeNull();
  });

  it('aktivní pořadatel: 200 a e-mail dorazí', async () => {
    await clone.pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [fc.promoterId]);
    const to = `prepos-${Date.now()}@fix.test`;
    const r = await send(to);
    expect(r.status, r.body).toBe(200);
    let m = null;
    for (let i = 0; i < 10 && !m; i++) { await new Promise((res) => setTimeout(res, 500)); m = await mailpitLatest(to); }
    expect(m, 'e-mail se vstupenkami').not.toBeNull();
  });
});
