// @vitest-environment node
/**
 * Kolo 4 / krok 2 — /api/mock-qes/[requestId] nemělo produkční pojistku.
 *
 * Kolo 2 zablokovalo v produkci mock podpis přes POST /api/qes/webhook (MockQESProvider
 * vrací v produkci false). Jenže výchozí QES poskytovatel je `mock` a mock-qes routa
 * podpis zapisuje PŘÍMO (UPDATE status='signed') — v produkci tak kdokoli s ID žádosti
 * přečetl dokument a e-mail podepisujícího a smlouvu pořadatele „podepsal".
 *
 * Očekávané: NODE_ENV=production bez ALLOW_MOCK_PAYMENTS=1 → GET i POST 403, žádost zůstane
 * 'pending'. (Že mock mimo produkci funguje, ověřuje fix-r4-qes-policy — pod tixly_app
 * nefungoval vůbec kvůli R-58, migrace 489.)
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;
const env = process.env as Record<string, string | undefined>;

run('Krok 2 (kolo 4) — mock-qes je v produkci zablokované', () => {
  let clone: LocalClone;
  let reqId: string;
  const origEnv = env.NODE_ENV;
  const origAllow = env.ALLOW_MOCK_PAYMENTS;

  beforeAll(async () => {
    clone = await createLocalClone();
    const c = await clone.seed.chain();
    reqId = (await clone.pool.query<{ id: string }>(
      `INSERT INTO platform.qes_signing_requests (promoter_id, document_type, document_hash, document_content_b64, signer_email, signer_name)
       VALUES ($1,'promoter_contract','abc','VERTRAG','podpis@poradatel.test','Jednatel') RETURNING id`, [c.promoterId])).rows[0].id;
  }, 180_000);
  afterEach(() => { env.NODE_ENV = origEnv; env.ALLOW_MOCK_PAYMENTS = origAllow; });
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const call = async (method: 'GET' | 'POST') => {
    const mod = await import('@/app/api/mock-qes/[requestId]/route');
    return throughMiddleware(new Request(`http://localhost/api/mock-qes/${reqId}`, {
      method, headers: method === 'POST' ? { 'content-type': 'application/json' } : {},
      body: method === 'POST' ? JSON.stringify({ action: 'sign' }) : undefined,
    }), (mod as unknown as Record<string, H>)[method], { params: { requestId: reqId } });
  };

  it('produkce: GET 403 bez dokumentu, POST 403 a žádost zůstane pending', async () => {
    env.NODE_ENV = 'production';
    delete env.ALLOW_MOCK_PAYMENTS;
    const g = await call('GET');
    const gb = await g.text();
    expect(g.status, gb).toBe(403);
    expect(gb).not.toContain('podpis@poradatel.test');
    const p = await call('POST');
    expect(p.status, await p.clone().text()).toBe(403);
    const st = (await clone.pool.query(`SELECT status FROM platform.qes_signing_requests WHERE id=$1`, [reqId])).rows[0].status;
    expect(st).toBe('pending');
  });

});
