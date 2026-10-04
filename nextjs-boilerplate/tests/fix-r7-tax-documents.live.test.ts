// @vitest-environment node
/**
 * Kolo 7 / krok 2b — daňové doklady kupci (C-54).
 * Dřív: jedna sazba z `promoters.vat_rate_pct ?? 0`, číslo MAX+1 (při souběhu duplicita), bez dobropisu.
 *
 * Očekávané:
 *   - plátce: rozpis základ / DPH / celkem po sazbách, sazba k datu zaplacení (lib/tax/vat.ts);
 *   - neplátce: doklad bez DPH (žádný rozpis), PDF route vrací doklad;
 *   - číslo z řady per pořadatel × rok bez děr a duplicit i při 50 souběžných dokladech a po ROLLBACK;
 *   - refund zaplacené objednávky s dokladem → dobropis se zápornými částkami po sazbách a odkazem;
 *   - doklad kupce (GET) je idempotentní; v kódu není výchozí 0 %.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { Pool, type PoolClient } from 'pg';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;
const APP_URL = process.env.FIX_DB_APP_URL ?? 'postgresql://tixly_app:fixapp@localhost:55632/e2e';
const GOPAY = process.env.FIX_GOPAY_URL ?? 'http://localhost:3998';
const SRC = path.resolve(__dirname, '../src');

describe('Kolo 7 — doklady bez výchozí sazby 0 %', () => {
  it('src/ neobsahuje `vat_rate_pct ?? 0`', () => {
    const off: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n) && /vat_rate_pct\s*\?\?\s*0/.test(readFileSync(p, 'utf8'))) off.push(path.relative(SRC, p));
      }
    };
    walk(SRC);
    expect(off).toEqual([]);
  });
});

run('Kolo 7 — daňové doklady, řady, dobropisy', () => {
  let clone: LocalClone;
  let app: Pool;

  beforeAll(async () => {
    process.env.GOPAY_REFUND_TIMEOUT_MS = '2500';
    clone = await createLocalClone();
    app = new Pool({ connectionString: APP_URL, max: 20 });
  }, 180_000);
  afterAll(async () => { await app?.end(); await clone?.cleanup(); }, 60_000);

  /** Zaplacená objednávka s položkami [{price, code}] na akci pořadatele. */
  async function paidOrder(c: Awaited<ReturnType<LocalClone['seed']['chain']>>, items: { price: number; code: string | null }[]) {
    const o = await clone.seed.order(c, { quantity: 1, unitPrice: items[0].price, status: 'paid' });
    await clone.pool.query(`UPDATE catalog.ticket_types SET vat_rate_code=$2, base_price=$3 WHERE id=$1`, [c.ticketTypeId, items[0].code, items[0].price]);
    let total = items[0].price;
    for (const it of items.slice(1)) {
      const tt = (await clone.pool.query<{ id: string }>(
        `INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, visibility, vat_rate_code)
         VALUES ($1,'Druhý typ','standing',$2,10,10,'public',$3) RETURNING id`, [c.eventId, it.price, it.code])).rows[0].id;
      await clone.pool.query(`INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price) VALUES ($1,$2,1,$3,$3)`, [o.orderId, tt, it.price]);
      total += it.price;
    }
    await clone.pool.query(`UPDATE orders.orders SET total_amount=$2, paid_at=NOW() WHERE id=$1`, [o.orderId, total]);
    return o.orderId;
  }

  async function issue(orderId: string, client?: PoolClient) {
    const own = !client;
    const cl = client ?? (await app.connect());
    try {
      if (own) await cl.query('BEGIN');
      const { asSystemInTx } = await import('@/lib/db/rls-pool');
      const { issueOrderDocument } = await import('@/lib/accounting/documents');
      const r = await asSystemInTx(cl, () => issueOrderDocument(cl, orderId));
      if (own) await cl.query('COMMIT');
      return r;
    } catch (e) {
      if (own) await cl.query('ROLLBACK');
      throw e;
    } finally {
      if (own) cl.release();
    }
  }
  const lines = async (invoiceId: string) => (await clone.pool.query(
    `SELECT vat_rate_code, rate_pct::float AS rate, base_minor::int AS base, vat_minor::int AS vat, total_minor::int AS total
       FROM orders.invoice_vat_lines WHERE invoice_id=$1 ORDER BY rate_pct DESC`, [invoiceId])).rows;

  it('plátce, dvě sazby: rozpis po sazbách k datu zaplacení (500 Kč při 12 %, 121 Kč při 21 %)', async () => {
    const c = await clone.seed.chain();
    const orderId = await paidOrder(c, [{ price: 50000, code: 'CZ_REDUCED' }, { price: 12100, code: 'CZ_STANDARD' }]);
    const { invoiceId } = await issue(orderId);
    expect(await lines(invoiceId)).toEqual([
      { vat_rate_code: 'CZ_STANDARD', rate: 21, base: 10000, vat: 2100, total: 12100 },
      { vat_rate_code: 'CZ_REDUCED', rate: 12, base: 44643, vat: 5357, total: 50000 },
    ]);
    const inv = (await clone.pool.query(`SELECT doc_type, supplier_vat_payer, total_minor::int t, subtotal_minor::int s, vat_amount_minor::int v, invoice_number n FROM orders.invoices WHERE id=$1`, [invoiceId])).rows[0];
    expect(inv).toMatchObject({ doc_type: 'invoice', supplier_vat_payer: true, t: 62100, s: 54643, v: 7457 });
    expect(inv.n).toMatch(new RegExp(`^${new Date().getFullYear()}-0001$`));
  });

  it('hranice zaokrouhlení: 0,14 Kč při 12 % → DPH 0,02 Kč (přesně 0,5 haléře nahoru)', async () => {
    const c = await clone.seed.chain();
    const orderId = await paidOrder(c, [{ price: 14, code: 'CZ_REDUCED' }]);
    const { invoiceId } = await issue(orderId);
    expect(await lines(invoiceId)).toEqual([{ vat_rate_code: 'CZ_REDUCED', rate: 12, base: 12, vat: 2, total: 14 }]);
  });

  it('neplátce: doklad bez DPH a bez rozpisu; PDF route pořadatele vrací PDF', async () => {
    const c = await clone.seed.chain({ vatPayer: false, dic: null, vatRateCode: null });
    const orderId = await paidOrder(c, [{ price: 30000, code: null }]);
    const { invoiceId } = await issue(orderId);
    expect(await lines(invoiceId)).toEqual([]);
    const inv = (await clone.pool.query(`SELECT supplier_vat_payer, vat_amount_minor::int v, subtotal_minor::int s FROM orders.invoices WHERE id=$1`, [invoiceId])).rows[0];
    expect(inv).toEqual({ supplier_vat_payer: false, v: 0, s: 30000 });
    const { loadTaxDocument } = await import('@/lib/accounting/documents');
    const { documentTitle } = await import('@/lib/accounting/invoice-pdf');
    const cl = await app.connect();
    try {
      await cl.query('BEGIN');
      const { asSystemInTx } = await import('@/lib/db/rls-pool');
      const doc = await asSystemInTx(cl, () => loadTaxDocument(cl, invoiceId));
      await cl.query('COMMIT');
      expect(doc?.supplier.vatPayer).toBe(false);
      expect(doc && documentTitle(doc)).toBe('DOKLAD');
    } finally { cl.release(); }
    await clone.pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [c.promoterId]);
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [c.adminUserId])).rows[0].email;
    const tok = await signAccessToken({ id: c.adminUserId, email, name: 'S' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: c.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
    } as never);
    const { GET } = await import('@/app/api/admin/invoices/[id]/pdf/route');
    const r = await throughMiddleware(new Request(`http://localhost/api/admin/invoices/${invoiceId}/pdf`, { headers: { authorization: `Bearer ${tok}` } }),
      GET as unknown as H, { params: { id: invoiceId } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it('50 souběžných dokladů jednoho pořadatele: čísla 1…50 bez děr a duplicit; ROLLBACK číslo nespálí', async () => {
    const c = await clone.seed.chain({ totalQty: 1000, remainingQty: 1000 });
    const orders: string[] = [];
    for (let i = 0; i < 51; i++) orders.push(await paidOrder(c, [{ price: 10000 + i, code: 'CZ_REDUCED' }]));
    // transakce, která číslo přidělí a pak se vrátí → číslo se nesmí ztratit
    const cl = await app.connect();
    try {
      await cl.query('BEGIN');
      await issue(orders[50], cl);
      await cl.query('ROLLBACK');
    } finally { cl.release(); }
    await Promise.all(orders.slice(0, 50).map((o) => issue(o)));
    const nums = (await clone.pool.query<{ n: string }>(
      `SELECT invoice_number n FROM orders.invoices WHERE promoter_id=$1 AND doc_type='invoice' ORDER BY invoice_number`, [c.promoterId])).rows.map((r) => Number(r.n.split('-')[1]));
    expect(nums).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  }, 120_000);

  it('refund zaplacené objednávky s dokladem → dobropis se zápornými částkami po sazbách a odkazem', async () => {
    const c = await clone.seed.chain({ totalQty: 50, remainingQty: 50, basePrice: 30000 });
    await clone.pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [c.promoterId]);
    const { POST: checkout } = await import('@/app/api/checkout/route');
    const co = await checkout(new Request('http://localhost/api/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.77' },
      body: JSON.stringify({ eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 1, buyerEmail: `cn-${randomUUID().slice(0, 8)}@fix.test`, buyerName: 'K' }),
    }) as unknown as NextRequest);
    const cj = (await co.json()) as { orderId: string; paymentId: string };
    await fetch(`${GOPAY}/_ctl/${cj.paymentId}`, { method: 'POST', body: JSON.stringify({ state: 'PAID' }) });
    const { GET: wh } = await import('@/app/api/payments/gopay/webhook/route');
    expect((await wh(new Request(`http://localhost/api/payments/gopay/webhook?id=${cj.paymentId}`) as unknown as NextRequest)).status).toBe(200);
    await clone.seed.tickets(cj.orderId);
    const { invoiceId } = await issue(cj.orderId);
    const { POST: refund } = await import('@/app/api/admin/orders/[orderId]/refund/route');
    const rr = await refund(new Request(`http://localhost/api/admin/orders/${cj.orderId}/refund`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': c.adminUserId }, body: '{}',
    }) as unknown as NextRequest, { params: { orderId: cj.orderId } });
    expect(rr.status, await rr.clone().text()).toBe(200);
    const cn = (await clone.pool.query(
      `SELECT id, invoice_number n, total_minor::int t, corrects_invoice_id c FROM orders.invoices WHERE order_id=$1 AND doc_type='credit_note'`, [cj.orderId])).rows;
    expect(cn).toHaveLength(1);
    expect(cn[0]).toMatchObject({ t: -30000, c: invoiceId });
    expect(cn[0].n).toMatch(/^D\d{4}-0001$/);
    expect(await lines(cn[0].id)).toEqual([{ vat_rate_code: 'CZ_REDUCED', rate: 12, base: -26786, vat: -3214, total: -30000 }]);
  });

  it('doklad kupce (GET) vznikne jednou — druhé volání vrátí stejný doklad', async () => {
    const c = await clone.seed.chain();
    const orderId = await paidOrder(c, [{ price: 25000, code: 'CZ_REDUCED' }]);
    const buyer = (await clone.pool.query<{ user_id: string }>(`SELECT user_id FROM orders.orders WHERE id=$1`, [orderId])).rows[0].user_id;
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [buyer])).rows[0].email;
    const tok = await signAccessToken({ id: buyer, email, name: 'K' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
    const { GET } = await import('@/app/api/buyer/orders/[orderId]/invoice/route');
    for (let i = 0; i < 2; i++) {
      const r = await throughMiddleware(new Request(`http://localhost/api/buyer/orders/${orderId}/invoice`, { headers: { authorization: `Bearer ${tok}` } }),
        GET as unknown as H, { params: { orderId } });
      expect(r.status, await r.clone().text()).toBe(200);
      expect(r.headers.get('content-disposition')).toMatch(/danovy-doklad/);
    }
    expect((await clone.pool.query(`SELECT count(*)::int n FROM orders.invoices WHERE order_id=$1`, [orderId])).rows[0].n).toBe(1);
  });
});
