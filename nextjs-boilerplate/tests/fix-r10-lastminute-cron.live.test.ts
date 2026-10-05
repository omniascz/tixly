// @vitest-environment node
/**
 * Kolo 10 / krok 3 — cron lastminute: Vercel cron volá GET s `Authorization: Bearer CRON_SECRET`.
 * Dřív route exportovala jen POST (GET → 405) a middleware by bez JWT vrátil 401 — cron nikdy neběžel.
 * Přes SKUTEČNÝ middleware: s tajemstvím 200 a pravidlo se uplatní (sleva na termín s nízkou obsazeností),
 * bez tajemství / se špatným 401 a cena se nezmění.
 */
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest) => Promise<Response>;

run('Kolo 10 — cron lastminute přes GET', () => {
  let clone: LocalClone;
  let eventId: string;
  let ticketTypeId: string;
  beforeAll(async () => {
    clone = await createLocalClone();
    const c = await clone.seed.chain({ basePrice: 50000, totalQty: 100, remainingQty: 100 });
    eventId = c.eventId;
    ticketTypeId = c.ticketTypeId;
    // termín za 2 h, 0 % obsazenost, pravidlo: 3 h před začátkem pod 60 % → −30 %
    await clone.pool.query(`UPDATE catalog.events SET date_start = NOW() + INTERVAL '2 hours' WHERE id = $1`, [eventId]);
    await clone.pool.query(
      `INSERT INTO catalog.lastminute_rules (event_id, hours_before, min_occupancy_pct, discount_pct) VALUES ($1, 3, 60, 30)`,
      [eventId],
    );
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const get = async (headers: Record<string, string>) => {
    const { GET } = await import('@/app/api/admin/lastminute/check/route');
    return throughMiddleware(new Request('http://localhost/api/admin/lastminute/check', { headers }), GET as H);
  };
  const price = async () =>
    (await clone.pool.query<{ base_price: number }>(`SELECT base_price FROM catalog.ticket_types WHERE id = $1`, [ticketTypeId])).rows[0].base_price;

  it('bez tajemství 401, se špatným 401 — cena beze změny', async () => {
    expect((await get({})).status).toBe(401);
    expect((await get({ authorization: 'Bearer spatne-tajemstvi' })).status).toBe(401);
    expect(await price()).toBe(50000);
  });

  it('s tajemstvím 200 a sleva se uplatní právě jednou', async () => {
    const r = await get({ authorization: `Bearer ${process.env.CRON_SECRET}` });
    const body = await r.json() as { checked: number; triggered: number };
    expect(r.status, JSON.stringify(body)).toBe(200);
    expect(body.triggered).toBeGreaterThanOrEqual(1);
    expect(await price()).toBe(35000);
    const rule = await clone.pool.query(`SELECT triggered_at FROM catalog.lastminute_rules WHERE event_id = $1`, [eventId]);
    expect(rule.rows[0].triggered_at).not.toBeNull();
    // druhý běh už pravidlo nebere
    const r2 = await get({ authorization: `Bearer ${process.env.CRON_SECRET}` });
    expect(r2.status).toBe(200);
    expect(await price()).toBe(35000);
  });
});
