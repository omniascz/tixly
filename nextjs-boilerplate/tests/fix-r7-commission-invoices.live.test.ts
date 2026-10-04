// @vitest-environment node
/**
 * Kolo 7 / krok 2c — faktury provize platformy pořadatelům (C-54). Dřív: GET /api/platform/admin/invoices
 * byl stub, faktura provize neexistovala, údaje platformy jako dodavatele nikde.
 *
 * Očekávané:
 *   - bez fakturačních údajů platformy → 503 PLATFORM_BILLING_NOT_CONFIGURED (nevymýšlíme dodavatele);
 *   - plátce bez DIČ nelze uložit; ne-admin 403;
 *   - faktura: dodavatel = údaje platformy, odběratel = pořadatel, DPH 21 % z provize (včetně DPH), idempotentní;
 *   - číslo z řady per pořadatel × rok bez děr; ISDOC faktury projde oficiálním XSD;
 *   - pořadatel vidí jen svoje faktury (cizí → 404).
 */
import { readFileSync } from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, expect, it, describe } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;
const XSD = path.resolve(__dirname, '../src/lib/accounting/xsd/isdoc-invoice-6.0.2.xsd');

run('Kolo 7 — faktury provize platformy', () => {
  let clone: LocalClone;
  let adminTok: string;

  const tokenFor = async (userId: string, memberships: unknown[] = [], isPlatformAdmin = false) => {
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [userId])).rows[0].email;
    return signAccessToken({ id: userId, email, name: 'U' } as never, { isPlatformAdmin, promoterMemberships: memberships } as never);
  };
  const ownerTok = (c: { adminUserId: string; promoterId: string }) =>
    tokenFor(c.adminUserId, [{ promoterId: c.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }]);

  const req = async (method: string, url: string, mod: () => Promise<Record<string, unknown>>, body: unknown, tok?: string, ctx: unknown = {}) => {
    const m = await mod();
    const r = await throughMiddleware(new Request(`http://localhost${url}`, {
      method,
      headers: { 'content-type': 'application/json', origin: 'http://localhost', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), m[method] as H, ctx);
    return r;
  };
  const issue = (payoutId: string, tok = adminTok) =>
    req('POST', '/api/platform/admin/invoices', () => import('@/app/api/platform/admin/invoices/route'), { payoutId }, tok);
  const putIdentity = (body: unknown, tok = adminTok) =>
    req('PUT', '/api/platform/admin/billing-identity', () => import('@/app/api/platform/admin/billing-identity/route'), body, tok);

  async function payout(promoterId: string, fees: number, periodTo = '2026-09-30T12:00:00Z') {
    return (await clone.pool.query<{ id: string }>(
      `INSERT INTO platform.payouts (promoter_id, period_from, period_to, gross_revenue, platform_fees, net_payout, status, payout_cycle)
       VALUES ($1, $3::timestamptz - interval '30 days', $3::timestamptz, $2 * 40, $2, $2 * 39, 'pending', 'monthly') RETURNING id`,
      [promoterId, fees, periodTo])).rows[0].id;
  }

  const identity = {
    legalName: 'Platforma Test s.r.o.', ico: '12345678', dic: 'CZ12345678', vatPayer: true,
    street: 'Testovací 1', city: 'Praha', zip: '110 00', country: 'CZ', bankAccount: '123/0100', email: 'fakturace@fix.test',
  };

  beforeAll(async () => {
    clone = await createLocalClone();
    const a = await clone.seed.user('cadm', 'Admin');
    await clone.pool.query(`UPDATE identity.users SET is_platform_admin = TRUE WHERE id=$1`, [a.id]);
    adminTok = await tokenFor(a.id, [], true);
    await clone.pool.query(`DELETE FROM platform.billing_identity`);
  }, 180_000);
  afterAll(async () => {
    await clone?.pool.query(`DELETE FROM platform.billing_identity`).catch(() => undefined);
    await clone?.cleanup();
  }, 60_000);

  it('bez údajů platformy → 503 PLATFORM_BILLING_NOT_CONFIGURED; ne-admin 403; plátce bez DIČ 422', async () => {
    const c = await clone.seed.chain();
    const p = await payout(c.promoterId, 12100);
    const r = await issue(p);
    expect(r.status).toBe(503);
    expect(await r.text()).toMatch(/PLATFORM_BILLING_NOT_CONFIGURED/);
    expect((await issue(p, await ownerTok(c))).status).toBe(403);
    expect((await putIdentity({ ...identity, dic: null })).status).toBe(422);
    expect((await putIdentity(identity, await ownerTok(c))).status).toBe(403);
    expect((await clone.pool.query(`SELECT count(*)::int n FROM platform.commission_invoices WHERE payout_id=$1`, [p])).rows[0].n).toBe(0);
  });

  it('faktura provize: dodavatel = platforma, 21 % z provize, idempotentní, čísla bez děr, ISDOC dle XSD', async () => {
    expect((await putIdentity(identity)).status).toBe(200);
    const c = await clone.seed.chain();
    const p1 = await payout(c.promoterId, 12100);
    const p2 = await payout(c.promoterId, 999, '2026-10-02T12:00:00Z');

    const r1 = await issue(p1);
    expect(r1.status).toBe(201);
    const { invoiceId } = (await r1.json()) as { invoiceId: string };
    const again = await issue(p1);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { invoiceId: string }).invoiceId).toBe(invoiceId);
    const r2 = await issue(p2);
    expect(r2.status).toBe(201);

    const rows = (await clone.pool.query(
      `SELECT invoice_number, base_minor::int b, vat_minor::int v, total_minor::int t, rate_pct::text r, taxable_supply_date::text d,
              supplier->>'name' sup, supplier->>'dic' sdic, customer->>'name' cust
         FROM platform.commission_invoices WHERE promoter_id=$1 ORDER BY invoice_number`, [c.promoterId])).rows;
    const year = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Prague' }).slice(0, 4);
    const pref = `TX${year}-${c.promoterId.slice(0, 8).toUpperCase()}-`;
    expect(rows.map((x) => x.invoice_number)).toEqual([`${pref}0001`, `${pref}0002`]);
    // 12100 = 10000 základ + 2100 DPH 21 %; 999 → DPH round(999·21/121 = 173,38) = 173
    expect(rows[0]).toMatchObject({ b: 10000, v: 2100, t: 12100, r: '21.00', d: '2026-09-30', sup: identity.legalName, sdic: 'CZ12345678' });
    expect(rows[1]).toMatchObject({ b: 826, v: 173, t: 999 });
    expect(rows[0].cust).toBeTruthy();

    // ISDOC faktury provize přes route pořadatele → oficiální XSD
    const own = await req('GET', `/api/admin/commission-invoices/${invoiceId}?format=isdoc`,
      () => import('@/app/api/admin/commission-invoices/[id]/route'), undefined, await ownerTok(c), { params: { id: invoiceId } });
    expect(own.status).toBe(200);
    const xml = await own.text();
    const { validateXML } = await import('xmllint-wasm');
    const v = await validateXML({ xml: [{ fileName: 'f.isdoc', contents: xml }], schema: [{ fileName: 'isdoc.xsd', contents: readFileSync(XSD, 'utf8') }] });
    expect(v.errors, JSON.stringify(v.errors)).toEqual([]);
    expect(xml).toContain('<ID>12345678</ID>');
    expect(xml).toContain('Platforma Test s.r.o.');

    const pdf = await req('GET', `/api/platform/admin/invoices/${invoiceId}`,
      () => import('@/app/api/platform/admin/invoices/[id]/route'), undefined, adminTok, { params: { id: invoiceId } });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');

    const list = await req('GET', '/api/admin/commission-invoices', () => import('@/app/api/admin/commission-invoices/route'), undefined, await ownerTok(c));
    expect(((await list.json()) as { invoices: unknown[] }).invoices).toHaveLength(2);

    // cizí pořadatel fakturu nevidí
    const other = await clone.seed.chain();
    const foreign = await req('GET', `/api/admin/commission-invoices/${invoiceId}`,
      () => import('@/app/api/admin/commission-invoices/[id]/route'), undefined, await ownerTok(other), { params: { id: invoiceId } });
    expect(foreign.status).toBe(404);
    const otherList = await req('GET', '/api/admin/commission-invoices', () => import('@/app/api/admin/commission-invoices/route'), undefined, await ownerTok(other));
    expect(((await otherList.json()) as { invoices: unknown[] }).invoices).toHaveLength(0);
  });

  it('neplátce platforma: faktura bez DPH, ISDOC VATApplicable=false dle XSD', async () => {
    expect((await putIdentity({ ...identity, vatPayer: false, dic: null })).status).toBe(200);
    const c = await clone.seed.chain();
    const r = await issue(await payout(c.promoterId, 5000));
    expect(r.status).toBe(201);
    const { invoiceId } = (await r.json()) as { invoiceId: string };
    const row = (await clone.pool.query(`SELECT base_minor::int b, vat_minor::int v, rate_pct FROM platform.commission_invoices WHERE id=$1`, [invoiceId])).rows[0];
    expect(row).toEqual({ b: 5000, v: 0, rate_pct: null });
    const x = await req('GET', `/api/platform/admin/invoices/${invoiceId}?format=isdoc`,
      () => import('@/app/api/platform/admin/invoices/[id]/route'), undefined, adminTok, { params: { id: invoiceId } });
    const xml = await x.text();
    expect(xml).toContain('<VATApplicable>false</VATApplicable>');
    const { validateXML } = await import('xmllint-wasm');
    const v = await validateXML({ xml: [{ fileName: 'f.isdoc', contents: xml }], schema: [{ fileName: 'isdoc.xsd', contents: readFileSync(XSD, 'utf8') }] });
    expect(v.errors, JSON.stringify(v.errors)).toEqual([]);
  });
});
