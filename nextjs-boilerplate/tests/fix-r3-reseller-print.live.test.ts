// @vitest-environment node
/**
 * Kolo 3 / krok 5 — tisk vstupenek prodejce (`app/reseller/print/[orderId]`).
 *
 * Nález: stránka neověřovala prodejce vůbec — jen že objednávku prodal NĚJAKÝ prodejce
 * (`reseller_sales.order_id = $1`), dotazy běžely bez kontextu. Token prodejce je v localStorage,
 * serverová stránka ho neviděla. Navíc verifyResellerToken bral jakýkoli JWT téhož klíče
 * (bez RESELLER_JWT_SECRET = JWT_SECRET) — i přístupový token kupce — jako relaci prodejce.
 *
 * Po opravě: vstupenky dodá `GET /api/reseller/orders/[orderId]/tickets` (Bearer token prodejce,
 * requireReseller) jen když objednávka patří TOMUTO prodejci (reseller_sales.partner_id);
 * stránka je klientská a volá ho s tokenem z localStorage.
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

run('Krok 5 (kolo 3) — tisk vstupenek prodejce: kontext prodejce + vlastnictví objednávky', () => {
  let clone: LocalClone;
  let fc: Awaited<ReturnType<LocalClone['seed']['fullChain']>>;
  let tokA: string; let tokB: string; let buyerAccess: string;
  beforeAll(async () => {
    clone = await createLocalClone();
    fc = await clone.seed.fullChain();
    const mk = async (name: string) => {
      const id = randomUUID();
      await clone.pool.query(`INSERT INTO platform.reseller_partners (id, name, contact_email, password_hash, commission_pct, status) VALUES ($1,$2,$3,'!x',5,'active')`,
        [id, name, `${name}-${id.slice(0, 6)}@fix.test`]);
      return id;
    };
    const a = await mk('prodejna-a'); const b = await mk('prodejna-b');
    await clone.pool.query(`INSERT INTO orders.reseller_sales (partner_id, order_id, commission_pct, commission_amount_halire) VALUES ($1,$2,5,500)`, [a, fc.orderId]);
    const { signResellerToken } = await import('@/lib/reseller-auth');
    tokA = await signResellerToken({ partnerId: a, partnerName: 'A', commissionPct: 5 });
    tokB = await signResellerToken({ partnerId: b, partnerName: 'B', commissionPct: 5 });
    const { signAccessToken } = await import('@/lib/auth');
    buyerAccess = await signAccessToken({ id: fc.userId, email: 'x@fix.test', name: 'K' } as never, { isPlatformAdmin: false, promoterMemberships: [] });
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const get = async (orderId: string, token?: string) => {
    const { GET } = await import('@/app/api/reseller/orders/[orderId]/tickets/route');
    return throughMiddleware(new Request(`http://localhost/api/reseller/orders/${orderId}/tickets`, {
      headers: token ? { authorization: `Bearer ${token}` } : {} }), GET as H, { params: { orderId } });
  };

  it('verifyResellerToken: přístupový token kupce (týž klíč bez RESELLER_JWT_SECRET) NENÍ relace prodejce', async () => {
    const { verifyResellerToken } = await import('@/lib/reseller-auth');
    expect(await verifyResellerToken(buyerAccess)).toBeNull();
    expect((await verifyResellerToken(tokA))?.partnerName).toBe('A');
  });

  it('vlastní prodejce → 200 se vstupenkami objednávky', async () => {
    const r = await get(fc.orderId, tokA);
    expect(r.status, await r.clone().text()).toBe(200);
    const j = (await r.json()) as { tickets: Array<{ id: string }> };
    expect(j.tickets.length).toBeGreaterThan(0);
  });
  it('cizí prodejce → 404 (bez dat)', async () => {
    const r = await get(fc.orderId, tokB);
    expect(r.status).toBe(404);
    expect(JSON.stringify(await r.json())).not.toContain(fc.orderId.slice(0, 8));
  });
  it('bez tokenu → 401; přístupový token kupce jako token prodejce → 401', async () => {
    expect((await get(fc.orderId)).status).toBe(401);
    expect((await get(fc.orderId, buyerAccess)).status).toBe(401);
  });
  it('objednávka neprodaná prodejcem → 404', async () => {
    const other = await clone.seed.fullChain();
    expect((await get(other.orderId, tokA)).status).toBe(404);
  });
  it('stránka tisku čte vstupenky přes API s tokenem prodejce (ne serverový dotaz bez kontextu)', () => {
    const src = readFileSync(path.resolve(__dirname, '../src/app/reseller/print/[orderId]/page.tsx'), 'utf8');
    expect(src).toMatch(/^'use client'/);
    expect(src).toMatch(/\/api\/reseller\/orders\/\$\{orderId\}\/tickets/);
    expect(src).toMatch(/localStorage\.getItem\('resellerToken'\)/);
    expect(src).not.toMatch(/from '@\/lib\/db\/rls-pool'/);
  });
});
