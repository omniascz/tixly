// @vitest-environment node
/**
 * Kolo 4 / krok 2 — platform.qes_signing_requests: R-58 (policy čte app.bypass_rls, který
 * aplikace nenastavuje). Pod tixly_app řádek neviděl ani servisní kontext → mock-qes 404,
 * webhook žádost nenajde, podepisování smluv pořadatelů pod produkční rolí nefunguje.
 *
 * Očekávané po migraci 489: servisní kontext vidí a mění žádost; vlastní pořadatel ji vidí,
 * cizí ne; mock-qes mimo produkci funguje (GET 200, POST sign → signed).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;
const env = process.env as Record<string, string | undefined>;

run('Krok 2 (kolo 4) — qes_signing_requests pod tixly_app (migrace 489)', () => {
  let clone: LocalClone;
  let reqId: string;
  let own: { promoterId: string };
  let foreign: { promoterId: string };
  const origEnv = env.NODE_ENV;

  beforeAll(async () => {
    clone = await createLocalClone();
    own = await clone.seed.chain();
    foreign = await clone.seed.chain();
    reqId = (await clone.pool.query<{ id: string }>(
      `INSERT INTO platform.qes_signing_requests (promoter_id, document_type, document_hash, signer_email)
       VALUES ($1,'promoter_contract','h','s@poradatel.test') RETURNING id`, [own.promoterId])).rows[0].id;
  }, 180_000);
  afterEach(() => { env.NODE_ENV = origEnv; });
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  it('servisní kontext žádost vidí; vlastní pořadatel ano, cizí ne', async () => {
    const { db, runWithServiceContext, runWithPromoterContext } = await import('@/lib/db/rls-pool');
    const q = `SELECT count(*)::int AS n FROM platform.qes_signing_requests WHERE id=$1`;
    expect((await runWithServiceContext(() => db().query(q, [reqId]))).rows[0].n).toBe(1);
    expect((await runWithPromoterContext(own.promoterId, () => db().query(q, [reqId]))).rows[0].n).toBe(1);
    expect((await runWithPromoterContext(foreign.promoterId, () => db().query(q, [reqId]))).rows[0].n).toBe(0);
  });

  it('mock-qes mimo produkci: GET 200, POST sign → signed', async () => {
    env.NODE_ENV = 'development';
    const mod = (await import('@/app/api/mock-qes/[requestId]/route')) as Record<string, H>;
    const g = await throughMiddleware(new Request(`http://localhost/api/mock-qes/${reqId}`), mod.GET, { params: { requestId: reqId } });
    expect(g.status, await g.clone().text()).toBe(200);
    const p = await throughMiddleware(new Request(`http://localhost/api/mock-qes/${reqId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'sign' }),
    }), mod.POST, { params: { requestId: reqId } });
    expect(p.status, await p.clone().text()).toBe(200);
    const st = (await clone.pool.query(`SELECT status FROM platform.qes_signing_requests WHERE id=$1`, [reqId])).rows[0].status;
    expect(st).toBe('signed');
  });
});
