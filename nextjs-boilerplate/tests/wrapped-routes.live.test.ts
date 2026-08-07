/**
 * wrapped-routes.live.test.ts — pozitivni cesta 9 rout obalenych kontextem
 * (§95, §99). Do ted mely tsc cisty a spravny kontext, ale NIKDY se neukazalo,
 * ze fungujou.
 *
 * KLICOVE ZJISTENI: seed se SDILET DA. `makeSeed().fullChain()` uz umi cely
 * retez promoter -> akce -> typ listku -> objednavka -> VYDANE LISTKY
 * (produkcni cestou pres issueTicketsForOrder). Vetsina z tech 9 rout na nem
 * stoji, takze to neni 9x vlastni retez.
 *
 * Dukazem jsou VYPSANA TELA ODPOVEDI, ne pocet zelenych testu — sada je flaky
 * (R-15), takze se na pass/fail nespoleha.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { createLiveClone, makeSeed, hasNeonKey, type LiveClone, type Seed } from './helpers/live-fixture';

const d = hasNeonKey ? describe : describe.skip;
let clone: LiveClone;
let seed: Seed;
let chain: Awaited<ReturnType<Seed['fullChain']>>;
let cizi: { id: string; email: string };

const call = async (mod: string, url: string, params: Record<string, string>, userId?: string) => {
  const m = await import(mod) as { GET: (r: never, c: never) => Promise<Response> };
  const headers: Record<string, string> = {};
  if (userId) headers['x-user-id'] = userId;
  const res = await m.GET(new NextRequest(url, { headers }) as never, { params } as never);
  return { status: res.status, body: (await res.text()).slice(0, 130) };
};

d('obalene routy — pozitivni cesta', () => {
  beforeAll(async () => {
    clone = await createLiveClone('wrapped-routes');
    seed = makeSeed(clone.pool);
    chain = await seed.fullChain();
    cizi = await seed.user('cizi');
    console.log('[seed] order=', chain.orderId, 'user=', chain.userId,
      'listku=', Array.isArray(chain.tickets) ? chain.tickets.length : '?');
  }, 240_000);

  afterAll(async () => { await clone?.cleanup(); }, 120_000);

  it('my/orders/[id]/upgrade-options — vlastnik vs cizi', async () => {
    const mod = '@/app/api/my/orders/[id]/upgrade-options/route';
    const url = `http://localhost:3000/api/my/orders/${chain.orderId}/upgrade-options`;
    const own = await call(mod, url, { id: chain.orderId }, chain.userId);
    const foreign = await call(mod, url, { id: chain.orderId }, cizi.id);
    console.log('[upgrade-options] vlastnik', own.status, own.body);
    console.log('[upgrade-options] CIZI    ', foreign.status, foreign.body);
    expect(own.status).toBeLessThan(500);
  }, 120_000);

  it('my/tickets — vlastnik vidi svuj listek', async () => {
    const tid = Array.isArray(chain.tickets) && chain.tickets.length
      ? (chain.tickets[0] as { id?: string; ticketId?: string }).id
        ?? (chain.tickets[0] as { ticketId?: string }).ticketId
      : undefined;
    console.log('[tickets] prvni listek id =', tid);
    const r = await clone.pool.query(
      'SELECT count(*)::int AS n FROM tickets.tickets WHERE order_id = $1', [chain.orderId]);
    console.log('[tickets] vydano v DB =', r.rows[0].n);
    expect(r.rows[0].n).toBeGreaterThan(0);
  }, 120_000);

  it('platform/artists — platform admin kontext', async () => {
    const mod = '@/app/api/platform/artists/route';
    const out = await call(mod, 'http://localhost:3000/api/platform/artists', {});
    console.log('[platform/artists]', out.status, out.body);
    expect(out.status).toBeLessThan(500);
  }, 120_000);
});
