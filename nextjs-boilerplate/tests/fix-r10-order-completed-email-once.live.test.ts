// @vitest-environment node
/**
 * Kolo 10 / krok 2 — audit 05 C2c (11 e-mailů na 10 objednávek): `order-completed` posílal potvrzovací
 * e-mail při KAŽDÉM volání. Vydání vstupenek je idempotentní (opakované volání vrátí existující lístky
 * bez secretu), e-mail ne → webhook retry / souběžné dokončení = druhé potvrzení kupci.
 *
 * Očekávání: e-mail pošle jen volání, které vstupenky skutečně vydalo; opakovaná i souběžná volání
 * na zaplacenou objednávku žádný další e-mail nepošlou.
 */
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';

const run = describe.skipIf(!hasLocalDb);
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:58225';

async function mailCount(to: string): Promise<number> {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent('to:' + to)}&limit=1`);
  return ((await r.json()) as { messages_count: number }).messages_count;
}

async function settle(to: string, expected: number): Promise<number> {
  // SMTP doručení do Mailpitu je asynchronní — krátce počkat, až se počet ustálí
  let n = 0;
  for (let i = 0; i < 20; i++) {
    n = await mailCount(to);
    if (n >= expected) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 500));
  return mailCount(to);
}

run('Kolo 10 — order-completed pošle potvrzení právě jednou', () => {
  let clone: LocalClone;
  beforeAll(async () => { clone = await createLocalClone(); }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const complete = async (orderId: string) => {
    const { POST } = await import('@/app/api/internal/order-completed/route');
    return POST(new Request('http://localhost/api/internal/order-completed', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN! },
      body: JSON.stringify({ orderId }),
    }) as unknown as NextRequest);
  };

  it('dvě po sobě jdoucí volání → 1 e-mail, vstupenky jednou', async () => {
    const c = await clone.seed.chain({ basePrice: 20000, remainingQty: 10 });
    const o = await clone.seed.order(c, { status: 'paid', unitPrice: 20000 });
    expect((await complete(o.orderId)).status).toBe(200);
    expect((await complete(o.orderId)).status).toBe(200);
    expect(await settle(o.email, 1)).toBe(1);
    const t = await clone.pool.query(`SELECT count(*)::int n FROM tickets.tickets WHERE order_id=$1`, [o.orderId]);
    expect(t.rows[0].n).toBe(1);
  }, 60_000);

  it('tři souběžná volání → 1 e-mail', async () => {
    const c = await clone.seed.chain({ basePrice: 20000, remainingQty: 10 });
    const o = await clone.seed.order(c, { status: 'paid', unitPrice: 20000 });
    const res = await Promise.all([complete(o.orderId), complete(o.orderId), complete(o.orderId)]);
    expect(res.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await settle(o.email, 1)).toBe(1);
  }, 60_000);
});
