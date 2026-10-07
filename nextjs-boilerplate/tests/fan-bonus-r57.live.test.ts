/**
 * R-57 — `buyer/fan-bonus` mel `SET LOCAL app.is_platform_admin = 'true'`
 * a v cele route zadny `BEGIN`.
 *
 * Test ma dve casti a obe jsou nutne:
 *
 * 1. RED->GREEN na te ESKALACI. Merí se presne ten SQL, ktery se odstranil:
 *    mimo transakci nedela nic, UVNITR transakce nastavi admin. RED je tedy
 *    „radek by po oprave R-56 zacal platit", ne „dnes tece". Bez transakce by
 *    obe strany vysly stejne a test by nic nedokazoval (§190: RED se musi
 *    merit tak, aby se lisil).
 *
 * 2. NEREGRESE routy. Odstranenim radku nesmi routa prestat fungovat —
 *    stoji na SERVISNIM kontextu (`marketing.gift_vouchers` ma jen vetve
 *    admin/promoter a service, kupujici zadnou) a scopuje se sama pres
 *    `WHERE fbi.user_id = $1`. Overuje se, ze kupujici vidi SVUJ bonus a
 *    NEVIDI cizi.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { createLiveClone, makeSeed, hasLiveDb, type LiveClone, type Seed } from './helpers/live-fixture';

const d = hasLiveDb ? describe : describe.skip;

/** Presne ten radek, ktery R-57 odstranil. */
const ODSTRANENY_RADEK = "SET LOCAL app.is_platform_admin = 'true'";

d('R-57 — spici SET LOCAL v buyer/fan-bonus', () => {
  let clone: LiveClone;
  let seed: Seed;
  let chain: Awaited<ReturnType<Seed['fullChain']>>;
  let cizi: { id: string; email: string };

  beforeAll(async () => {
    clone = await createLiveClone('fan-bonus-r57');
    seed = makeSeed(clone.pool);
    chain = await seed.fullChain();
    cizi = await seed.user('cizi-fanbonus');

    // `fan_bonus_issued_pkey` je na SAMOTNEM `order_id` — jeden bonus na
    // objednavku. Cizi kupujici proto potrebuje VLASTNI objednavku, jinak
    // druhy INSERT skonci na 23505 (naraz jsem na to narazil).
    const ciziOrder = await seed.order(chain, { userId: cizi.id });

    // Bonus pro OBA kupujici, at je co izolovat. Tvar podle baseline
    // (fan_bonus_issued: order_id, voucher_id, event_id, user_id, earned_halire,
    // bonus_pct; gift_vouchers: code, amount_halire, balance_halire).
    for (const [uid, oid, code, castka] of [
      [chain.userId, chain.orderId, 'R57-VLASTNI', 5000],
      [cizi.id, ciziOrder.orderId, 'R57-CIZI', 7000],
    ] as const) {
      const v = await clone.pool.query<{ id: string }>(
        `INSERT INTO marketing.gift_vouchers (code, amount_halire, balance_halire, event_id)
         VALUES ($1, $2, $2, $3) RETURNING id`,
        [code, castka, chain.eventId],
      );
      await clone.pool.query(
        `INSERT INTO marketing.fan_bonus_issued
           (order_id, voucher_id, event_id, user_id, earned_halire, bonus_pct)
         VALUES ($1, $2, $3, $4, $5, 2.50)`,
        [oid, v.rows[0].id, chain.eventId, uid, castka],
      );
    }
  }, 240_000);

  afterAll(async () => { await clone?.cleanup(); }, 120_000);

  it('RED->GREEN: odstraneny radek by UVNITR transakce udelal z kupujiciho admina', async () => {
    const c = await clone.pool.connect();
    try {
      // RED — stav PRED opravou, kdyby `connect()` transakci otevrel
      await c.query('BEGIN');
      await c.query(ODSTRANENY_RADEK);
      const red = (await c.query("SELECT current_setting('app.is_platform_admin', true) AS v")).rows[0].v;
      await c.query('COMMIT');

      // GREEN — stav PO oprave: tentyz kontext, ale radek uz tam neni
      await c.query('BEGIN');
      const green = (await c.query("SELECT current_setting('app.is_platform_admin', true) AS v")).rows[0].v;
      await c.query('COMMIT');

      console.log(`[R-57] RED (s radkem, v transakci) = ${JSON.stringify(red)}`);
      console.log(`[R-57] GREEN (bez radku)           = ${JSON.stringify(green)}`);
      expect(red).toBe('true');            // eskalace byla armovana
      expect(green === '' || green === null).toBe(true);   // a je odjistena
    } finally { c.release(); }
  }, 120_000);

  it('NEREGRESE: kupujici vidi svuj bonus a NEVIDI cizi', async () => {
    const mod = await import('@/app/api/buyer/fan-bonus/route') as { GET: (r: never) => Promise<Response> };
    const volej = async (userId: string) => {
      const res = await mod.GET(
        new NextRequest('http://localhost:3000/api/buyer/fan-bonus', { headers: { 'x-user-id': userId } }) as never,
      );
      return { status: res.status, body: await res.text() };
    };

    const vlastni = await volej(chain.userId);
    console.log('[fan-bonus] vlastnik', vlastni.status, vlastni.body.slice(0, 200));
    expect(vlastni.status).toBe(200);
    expect(vlastni.body).toContain('R57-VLASTNI');
    expect(vlastni.body).not.toContain('R57-CIZI');

    const cizihoPohled = await volej(cizi.id);
    console.log('[fan-bonus] CIZI    ', cizihoPohled.status, cizihoPohled.body.slice(0, 200));
    expect(cizihoPohled.status).toBe(200);
    expect(cizihoPohled.body).toContain('R57-CIZI');
    expect(cizihoPohled.body).not.toContain('R57-VLASTNI');
  }, 120_000);
});
