// @vitest-environment node
/**
 * Kolo 2 / krok 5 — V6: vstupenka za 0 Kč.
 *
 * Audit P13: checkout s nulovou cenou založil u brány platbu na 0 Kč, objednávka zůstala
 * `pending` a vstupenka nevznikla (TODO.md tvrdil „HOTOVO").
 * Požadavek: objednávka s NULOVOU SERVEROVĚ SPOČTENOU cenou se dokončí bez brány, vystaví
 * vstupenky a pošle e-mail. Nesmí jít zneužít pro placené typy (cena od klienta se ignoruje).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, mailpitLatest, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
const FAKE = 'http://localhost:3998';

run('Krok 5 — V6: vstupenka zdarma se dokončí bez brány; placený typ ne', () => {
  let clone: LocalClone;
  beforeAll(async () => { clone = await createLocalClone(); }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const ip = () => `10.66.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  async function checkout(body: Record<string, unknown>) {
    const { POST } = await import('@/app/api/checkout/route');
    const r = await throughMiddleware(new Request('http://localhost/api/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip() }, body: JSON.stringify(body),
    }), POST as (r: NextRequest) => Promise<Response>);
    return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> };
  }
  const gopayPayments = async () => ((await (await fetch(`${FAKE}/_ctl/payments`)).json()) as unknown[]).length;

  it('typ za 0 Kč: objednávka paid bez brány, vstupenka vystavena, e-mail odeslán', async () => {
    const c = await clone.seed.chain({ basePrice: 0, totalQty: 10, remainingQty: 10 });
    const email = `free-${randomUUID().slice(0, 8)}@x.test`;
    const before = await gopayPayments();
    const r = await checkout({ eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 1, buyerEmail: email, buyerName: 'Host Zdarma' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.totalAmount).toBe(0);
    expect(await gopayPayments(), 'žádná platba u brány').toBe(before);
    const orderId = r.json.orderId as string;
    const o = (await clone.pool.query<{ status: string; payment_provider: string }>(`SELECT status, payment_provider FROM orders.orders WHERE id=$1`, [orderId])).rows[0];
    expect(o).toEqual({ status: 'paid', payment_provider: 'free' });
    const t = (await clone.pool.query<{ n: number }>(`SELECT count(*)::int n FROM tickets.tickets WHERE order_id=$1 AND status='valid'`, [orderId])).rows[0].n;
    expect(t, 'vstupenka vystavena').toBe(1);
    let mail = null;
    for (let i = 0; i < 20 && !mail; i++) { mail = await mailpitLatest(email); if (!mail) await new Promise((x) => setTimeout(x, 500)); }
    expect(mail, 'e-mail se vstupenkou v Mailpitu').not.toBeNull();
  });

  it('placený typ: klientem podvržená nulová cena se ignoruje — pending, platba u brány, žádná vstupenka', async () => {
    const c = await clone.seed.chain({ basePrice: 50000, totalQty: 10, remainingQty: 10 });
    const before = await gopayPayments();
    const r = await checkout({ eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 1, buyerEmail: `paid-${randomUUID().slice(0, 8)}@x.test`,
      buyerName: 'Útočník', totalAmount: 0, unitPrice: 0, priceHalire: 0 });
    expect([200, 422]).toContain(r.status);
    if (r.status === 200) {
      expect(r.json.totalAmount).toBe(50000);
      const orderId = r.json.orderId as string;
      const o = (await clone.pool.query<{ status: string }>(`SELECT status FROM orders.orders WHERE id=$1`, [orderId])).rows[0];
      expect(o.status).toBe('pending');
      expect(await gopayPayments(), 'platba u brány založena').toBe(before + 1);
      const t = (await clone.pool.query<{ n: number }>(`SELECT count(*)::int n FROM tickets.tickets WHERE order_id=$1`, [orderId])).rows[0].n;
      expect(t).toBe(0);
    }
  });
});
