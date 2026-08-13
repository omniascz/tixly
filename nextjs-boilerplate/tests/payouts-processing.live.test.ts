/**
 * §208 — sesta vrstva vyplat: `status = 'processing'` proti CHECKu (R-31).
 *
 * RED->GREEN se tentokrat dela **spravne pres `exclude`** (§190): tataz cesta
 * na klonu BEZ migrace 468 a S ni. Dosud se 468 overovala jen izolovane.
 *
 * `platform.payouts.status` CHECK puvodne povoloval
 * pending|approved|paid|failed|cancelled — `processing` v nem NENI, pritom
 * executor ho zapisuje na dvou mistech (`:148` wise, `:181` fio).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createLiveClone, makeSeed, hasNeonKey, type LiveClone } from './helpers/live-fixture';

const d = hasNeonKey ? describe : describe.skip;

async function seedPayout(clone: LiveClone): Promise<string> {
  const seed = makeSeed(clone.pool);
  const chain = await seed.chain();
  const r = await clone.pool.query<{ id: string }>(
    // period_from/period_to/payout_cycle jsou NOT NULL bez defaultu (§207)
    `INSERT INTO platform.payouts (promoter_id, net_payout, currency, status, retry_count,
                                   period_from, period_to, payout_cycle)
     VALUES ($1, 500000, 'CZK', 'pending', 0, NOW() - INTERVAL '30 days', NOW(), 'weekly')
     RETURNING id`,
    [chain.promoterId],
  );
  return r.rows[0].id;
}

/** Tvar zapisu z `executor.ts:181` (FIO vetev, CZK + IBAN). */
async function zkusProcessing(clone: LiveClone, payoutId: string): Promise<string> {
  try {
    await clone.pool.query(
      `UPDATE platform.payouts SET status = 'processing', payout_provider = 'fio' WHERE id = $1`,
      [payoutId],
    );
    return 'PROSLO';
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}

d('§208 — RED->GREEN migrace 468 na skutecne ceste', () => {
  let red: LiveClone;
  let green: LiveClone;

  beforeAll(async () => {
    // RED: klon BEZ 468 — jinak by to bylo GREEN vs GREEN (§190)
    red = await createLiveClone('payouts-red', { exclude: ['468'] });
  }, 240_000);

  afterAll(async () => {
    await red?.cleanup();
    await green?.cleanup();
  }, 240_000);

  it('RED (bez 468): zapis processing pada na 23514', async () => {
    const id = await seedPayout(red);
    const v = await zkusProcessing(red, id);
    console.log('[§208] RED (bez 468)  =', v);
    expect(v).toBe('23514');
  }, 180_000);

  it('GREEN (s 468): zapis processing projde', async () => {
    green = await createLiveClone('payouts-green');
    const id = await seedPayout(green);
    const v = await zkusProcessing(green, id);
    console.log('[§208] GREEN (s 468) =', v);
    expect(v).toBe('PROSLO');
  }, 300_000);
});
