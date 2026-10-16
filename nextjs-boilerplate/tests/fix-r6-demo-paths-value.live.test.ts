// @vitest-environment node
/**
 * Kolo 6 / krok 3 (analýza) — tři „demo" cesty k placené hodnotě BEZ platby, které kolo 1 (K1)
 * nezachytilo (vypnulo jen resale/buy, upgrade, voucher confirm, subscription holder confirm):
 *   - POST /api/buyer/cross-passes/purchase  — „Demo: instant purchase": aktivní cross-pass
 *     (vstup na více akcí) anonymně jen s buyerEmail, bez brány
 *   - POST /api/subscriptions/subscribe      — „Demo mock: instant aktivace": aktivní permanentka
 *     i pro hosta; checkout s `useSubscription` pak dá 100% slevu → vstupenky zdarma
 *   - POST /api/buyer/subscriptions          — totéž pro přihlášeného
 *
 * Očekávané (jako K1): bez skutečného platebního toku jsou vypnuté (404, demo-path-guard), žádný
 * aktivní řádek nevznikne; zapnout jde jen ENABLE_DEMO_PAYMENT_PATHS=1 mimo produkci.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

// Kolo 10: i se ZAPNUTÝM přepínačem předplatného musí demo-cesty zůstat zavřené (demo-path-guard) —
// bez toho by 404 z přepínače test splnil naprázdno.
process.env.NEXT_PUBLIC_FEATURE_SUBSCRIPTIONS = '1';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Kolo 6 — demo cesty k hodnotě bez platby jsou vypnuté', () => {
  let clone: LocalClone;
  let c: Awaited<ReturnType<LocalClone['seed']['chain']>>;
  let planId: string;
  let bundleId: string;
  let userTok: string;
  let userId: string;

  beforeAll(async () => {
    delete process.env.ENABLE_DEMO_PAYMENT_PATHS;
    clone = await createLocalClone();
    c = await clone.seed.chain();
    planId = (await clone.pool.query<{ id: string }>(
      `INSERT INTO subscriptions.plans (promoter_id, name, price_halire, billing_cycle, allowance_per_period, active)
       VALUES ($1,'Permanentka',99900,'monthly',4,TRUE) RETURNING id`, [c.promoterId])).rows[0].id;
    bundleId = (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.cross_pass_bundles (promoter_id, name, price_halire, active, remaining_qty)
       VALUES ($1,'Festivalový pas',150000,TRUE,10) RETURNING id`, [c.promoterId])).rows[0].id;
    const u = await clone.seed.user('subs', 'Kupec');
    userId = u.id;
    const { signAccessToken } = await import('@/lib/auth');
    userTok = await signAccessToken({ id: u.id, email: u.email, name: 'K' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  // Literální importy — dynamický import s proměnnou alias `@/` spolehlivě neřeší.
  const handlers = {
    xpass: () => import('@/app/api/buyer/cross-passes/purchase/route'),
    subscribe: () => import('@/app/api/subscriptions/subscribe/route'),
    buyerSubs: () => import('@/app/api/buyer/subscriptions/route'),
  };
  const post = async (url: string, which: keyof typeof handlers, body: unknown, tok?: string) => {
    const { POST } = await handlers[which]();
    const r = await throughMiddleware(new Request(`http://localhost${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      body: JSON.stringify(body),
    }), POST as unknown as H, {});
    return { status: r.status, body: await r.text() };
  };

  it('cross-pass purchase anonymně: 404 a žádné aktivní členství', async () => {
    const email = `xpass-${Date.now()}@fix.test`;
    const r = await post('/api/buyer/cross-passes/purchase', 'xpass', { bundleId, buyerEmail: email, buyerName: 'X' });
    expect(r.status, r.body).toBe(404);
    // přesně odpověď demo-guardu — 404 z jiné příčiny (např. PLAN_NOT_FOUND kvůli RLS) by test dělalo falešně zeleným
    expect(r.body).toBe('{"error":"NOT_FOUND"}');
    const n = (await clone.pool.query<{ n: number }>(`SELECT count(*)::int n FROM tickets.cross_pass_memberships WHERE bundle_id=$1`, [bundleId])).rows[0].n;
    expect(n).toBe(0);
  });

  it('subscriptions/subscribe jako host: 404 a žádné aktivní předplatné', async () => {
    const email = `sub-${Date.now()}@fix.test`;
    const r = await post('/api/subscriptions/subscribe', 'subscribe', { planId, buyerEmail: email });
    expect(r.status, r.body).toBe(404);
    // přesně odpověď demo-guardu — 404 z jiné příčiny (např. PLAN_NOT_FOUND kvůli RLS) by test dělalo falešně zeleným
    expect(r.body).toBe('{"error":"NOT_FOUND"}');
    const n = (await clone.pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM subscriptions.subscriptions s JOIN identity.users u ON u.id=s.user_id WHERE s.plan_id=$1 AND lower(u.email)=lower($2)`, [planId, email])).rows[0].n;
    expect(n).toBe(0);
  });

  it('buyer/subscriptions POST přihlášeně: 404 a žádné aktivní předplatné', async () => {
    const r = await post('/api/buyer/subscriptions', 'buyerSubs', { planId }, userTok);
    expect(r.status, r.body).toBe(404);
    // přesně odpověď demo-guardu — 404 z jiné příčiny (např. PLAN_NOT_FOUND kvůli RLS) by test dělalo falešně zeleným
    expect(r.body).toBe('{"error":"NOT_FOUND"}');
    const n = (await clone.pool.query<{ n: number }>(`SELECT count(*)::int n FROM subscriptions.subscriptions WHERE plan_id=$1 AND user_id=$2`, [planId, userId])).rows[0].n;
    expect(n).toBe(0);
  });
});
