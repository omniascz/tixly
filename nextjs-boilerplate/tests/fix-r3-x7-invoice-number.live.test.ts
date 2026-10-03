// @vitest-environment node
/**
 * Kolo 3 / krok 2 — X7: číslo faktury je unikátní per pořadatel, ne globálně.
 *
 * Oba generátory (buyer/orders/[id]/invoice, admin/invoices) číslují řadu `YYYY-NNNN`
 * PER POŘADATEL (MAX … WHERE promoter_id), ale DB měla UNIQUE(invoice_number) globálně →
 * první faktura DRUHÉHO pořadatele v roce (`2026-0001`) narazila na první fakturu prvního
 * pořadatele → 23505 → 500 a kupec doklad nedostal.
 *
 * Po opravě (migrace 487): UNIQUE(promoter_id, invoice_number).
 *   - první faktura dvou pořadatelů ve stejném roce → obě projdou (obě `YYYY-0001`);
 *   - duplicitní číslo u TÉHOŽ pořadatele → DB odmítne (23505).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 2 (kolo 3) — X7: číslo faktury unikátní per pořadatel', () => {
  let clone: LocalClone;
  let pool: Pool;
  beforeAll(async () => { clone = await createLocalClone(); pool = clone.pool; }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  async function invoiceFor(fc: { orderId: string; userId: string }) {
    const email = (await pool.query(`SELECT email FROM identity.users WHERE id=$1`, [fc.userId])).rows[0].email;
    const { signAccessToken } = await import('@/lib/auth');
    const t = await signAccessToken({ id: fc.userId, email, name: 'T' } as never, { isPlatformAdmin: false, promoterMemberships: [] });
    const { GET } = await import('@/app/api/buyer/orders/[orderId]/invoice/route');
    return throughMiddleware(new Request(`http://localhost/api/buyer/orders/${fc.orderId}/invoice`, { headers: { authorization: `Bearer ${t}` } }),
      GET as H, { params: { orderId: fc.orderId } });
  }
  const numberOf = async (orderId: string) =>
    (await pool.query<{ invoice_number: string }>(`SELECT invoice_number FROM orders.invoices WHERE order_id=$1`, [orderId])).rows[0]?.invoice_number;

  it('první faktura dvou pořadatelů ve stejném roce → obě projdou se stejným číslem řady', async () => {
    const year = new Date().getFullYear();
    // dva noví pořadatelé = dvě čisté řady
    const a = await clone.seed.fullChain();
    const b = await clone.seed.fullChain();
    // ať se kolize projeví bez ohledu na data jiných testů: obě řady začínají od 0001
    const ra = await invoiceFor(a);
    expect(ra.status, await ra.clone().text()).toBe(200);
    const rb = await invoiceFor(b);
    expect(rb.status, await rb.clone().text()).toBe(200);
    expect(await numberOf(a.orderId)).toBe(`${year}-0001`);
    expect(await numberOf(b.orderId)).toBe(`${year}-0001`);
  });

  it('duplicitní číslo u TÉHOŽ pořadatele → DB odmítne (23505)', async () => {
    const a = await clone.seed.fullChain();
    const r = await invoiceFor(a);
    expect(r.status).toBe(200);
    const num = await numberOf(a.orderId);
    const o2 = await clone.seed.order(a);
    const err = await pool.query(
      `INSERT INTO orders.invoices (order_id, promoter_id, invoice_number, due_date, subtotal_minor, vat_rate_pct, vat_amount_minor, total_minor, currency, customer_name)
       VALUES ($1, $2, $3, CURRENT_DATE + 14, 100, 21, 21, 121, 'CZK', 'Dup')`,
      [o2.orderId, a.promoterId, num],
    ).then(() => null, (e: { code?: string }) => e.code);
    expect(err).toBe('23505');
  });
});
