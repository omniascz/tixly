// @vitest-environment node
/**
 * Kolo 8 / krok 0 — vlastní pořadatel s provizí platformy 0.
 *
 * Očekávané: platform admin nastaví provizi 0 % a poplatek kupce 0; týdenní vyrovnání (cron
 * payouts-auto-settle) vytvoří výplatu s platform_fees = 0 (ne výchozích 5 %); vystavení faktury
 * provize k takové výplatě nic nevystaví a NEVRACÍ 503 ani když fakturační údaje platformy chybí.
 */
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;

run('Kolo 8 — provize platformy 0', () => {
  let clone: LocalClone;
  let adminTok: string;

  beforeAll(async () => {
    clone = await createLocalClone();
    const a = await clone.seed.user('r8adm', 'Admin');
    await clone.pool.query(`UPDATE identity.users SET is_platform_admin = TRUE WHERE id=$1`, [a.id]);
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [a.id])).rows[0].email;
    adminTok = await signAccessToken({ id: a.id, email, name: 'A' } as never, { isPlatformAdmin: true, promoterMemberships: [] } as never);
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 60_000);

  const call = async (method: string, url: string, mod: () => Promise<Record<string, unknown>>, body?: unknown, headers: Record<string, string> = {}, ctx: unknown = {}) => {
    const m = await mod();
    return throughMiddleware(new Request(`http://localhost${url}`, {
      method,
      headers: { 'content-type': 'application/json', origin: 'http://localhost', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), m[method] as H, ctx);
  };

  it('provize 0 %: výplata z vyrovnání má platform_fees 0; faktura provize nevznikne a nevrací 503', async () => {
    const c = await clone.seed.chain({ basePrice: 50000 });
    // provize 0 % přes platform admin API
    const p = await call('PATCH', `/api/platform/promoters/${c.promoterId}`, () => import('@/app/api/platform/promoters/[id]/route'),
      { feePctBps: 0, buyerFeeHalire: 0, feeCurrency: 'CZK', feeOverrideReason: 'vlastní pořadatel — provize 0' },
      { authorization: `Bearer ${adminTok}` }, { params: { id: c.promoterId } });
    expect(p.status, await p.clone().text()).toBe(200);
    const fs = (await clone.pool.query(`SELECT percentage_fee, buyer_fee_halire FROM platform.fee_schedules WHERE promoter_id=$1 AND is_active`, [c.promoterId])).rows;
    expect(fs).toEqual([{ percentage_fee: 0, buyer_fee_halire: 0 }]);

    // zaplacená objednávka v minulém týdnu na akci, která už proběhla (vyrovnání ji zahrne)
    await clone.pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [c.promoterId]);
    await clone.pool.query(`UPDATE catalog.events SET date_start = now() - interval '40 days', date_end = now() - interval '40 days' + interval '2 hours', completion_status='completed' WHERE id=$1`, [c.eventId]);
    const o = await clone.seed.order(c, { quantity: 1, unitPrice: 50000, status: 'paid' });
    await clone.pool.query(
      `UPDATE orders.orders SET created_at = date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '3 days', total_amount = 50000 WHERE id=$1`, [o.orderId]);

    const settle = await call('POST', '/api/internal/cron/payouts-auto-settle', () => import('@/app/api/internal/cron/payouts-auto-settle/route'),
      {}, { 'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN! });
    expect(settle.status, await settle.clone().text()).toBe(200);
    const payout = (await clone.pool.query(
      `SELECT id, gross_revenue, platform_fees FROM platform.payouts WHERE promoter_id=$1`, [c.promoterId])).rows;
    expect(payout).toHaveLength(1);
    expect(payout[0]).toMatchObject({ gross_revenue: 50000, platform_fees: 0 });

    // bez fakturačních údajů platformy — přesto žádné 503, žádná faktura
    await clone.pool.query(`DELETE FROM platform.billing_identity`);
    const inv = await call('POST', '/api/platform/admin/invoices', () => import('@/app/api/platform/admin/invoices/route'),
      { payoutId: payout[0].id }, { authorization: `Bearer ${adminTok}` });
    const body = await inv.json();
    expect(inv.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ created: false, invoiceId: null, reason: 'NO_COMMISSION' });
    expect((await clone.pool.query(`SELECT count(*)::int n FROM platform.commission_invoices WHERE payout_id=$1`, [payout[0].id])).rows[0].n).toBe(0);
  });

  it('kupec u pořadatele s poplatkem 0 neplatí servisní poplatek', async () => {
    const c = await clone.seed.chain({ basePrice: 40000 });
    await call('PATCH', `/api/platform/promoters/${c.promoterId}`, () => import('@/app/api/platform/promoters/[id]/route'),
      { feePctBps: 0, buyerFeeHalire: 0, feeCurrency: 'CZK' }, { authorization: `Bearer ${adminTok}` }, { params: { id: c.promoterId } });
    const { POST } = await import('@/app/api/checkout/route');
    const r = await (POST as unknown as H)(new Request('http://localhost/api/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.120.4' },
      body: JSON.stringify({ eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 1, buyerEmail: `zc-${randomUUID().slice(0, 6)}@tixly.test`, buyerName: 'Z' }),
    }) as unknown as NextRequest);
    const j = await r.json();
    expect(r.status, JSON.stringify(j)).toBe(200);
    const o = (await clone.pool.query(`SELECT total_amount, COALESCE(service_fee_minor,0)::int fee FROM orders.orders WHERE id=$1`, [j.orderId])).rows[0];
    expect(o).toEqual({ total_amount: 40000, fee: 0 });
  });
});
