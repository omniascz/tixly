/**
 * §207 — RED->GREEN pro opravu vyplatniho SELECTu (§203, §206).
 *
 * Migrace v tom zadna neni, takze `exclude` (§190) se nepouziva — RED je
 * PUVODNI TVAR DOTAZU, GREEN opraveny. Oba se pousti proti TEMUZ klonu
 * a temuz radku, aby se nelisilo nic jineho.
 *
 * Merí se pod `tixly_app` (fixture to vynucuje) v SERVISNIM kontextu — tak,
 * jak cestu pousti cron.
 *
 * PEEL: po GREEN se jde o krok dal a merí se `UPDATE platform.payouts`,
 * protoze R-30 tvrdi, ze servisni UPDATE tam vraci `rowCount=0` bez chyby.
 * Ta vrstva se dosud NIKDY neprojevila — cesta spadla driv.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createLiveClone, makeSeed, hasLiveDb, type LiveClone, type Seed } from './helpers/live-fixture';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { ENABLED_PAYOUT_CHANNELS } from '@/lib/payouts/executor';

const d = hasLiveDb ? describe : describe.skip;

const RED = `SELECT py.id AS payout_id, p.payout_currency, p.wise_recipient_id, p.paypal_payout_email
             FROM platform.payouts py JOIN platform.promoters p ON p.id = py.promoter_id`;
const GREEN = `SELECT py.id AS payout_id, py.promoter_id, py.net_payout, py.currency, py.retry_count,
                      p.name AS promoter_name, p.iban, p.swift_bic, p.payout_method,
                      p.primary_currency AS payout_currency
               FROM platform.payouts py JOIN platform.promoters p ON p.id = py.promoter_id
               WHERE py.status = 'pending' AND py.net_payout > 0`;

d('§207 vyplaty — RED->GREEN na SELECTu + PEEL', () => {
  let clone: LiveClone;
  let seed: Seed;
  let payoutId: string;

  beforeAll(async () => {
    clone = await createLiveClone('payouts-select');
    seed = makeSeed(clone.pool);
    const chain = await seed.chain();
    const r = await clone.pool.query<{ id: string }>(
      // period_from/period_to/payout_cycle jsou NOT NULL bez defaultu — 23502 dvakrat
      // za sebou, seed se odloupaval stejne jako sama cesta (§207)
      `INSERT INTO platform.payouts (promoter_id, net_payout, currency, status, retry_count,
                                     period_from, period_to, payout_cycle)
       VALUES ($1, 500000, 'CZK', 'pending', 0, NOW() - INTERVAL '30 days', NOW(), 'weekly') RETURNING id`,
      [chain.promoterId],
    );
    payoutId = r.rows[0].id;
    await clone.pool.query(
      `UPDATE platform.promoters SET iban = 'CZ6508000000192000145399', payout_method = 'bank_transfer' WHERE id = $1`,
      [chain.promoterId],
    );
  }, 240_000);

  afterAll(async () => { await clone?.cleanup(); }, 120_000);

  it('RED: puvodni dotaz pada na 42703', async () => {
    await runWithServiceContext(async () => {
      const c = await db().connect();
      try {
        await c.query('BEGIN');
        let code = 'ZADNA CHYBA';
        try { await c.query(RED); } catch (e) { code = (e as { code?: string }).code ?? String(e); }
        await c.query('ROLLBACK');
        console.log('[§207] RED  =', code);
        expect(code).toBe('42703');
      } finally { c.release(); }
    });
  }, 120_000);

  it('GREEN: opraveny dotaz vrati radek', async () => {
    await runWithServiceContext(async () => {
      const c = await db().connect();
      try {
        await c.query('BEGIN');
        const r = await c.query(GREEN);
        await c.query('COMMIT');
        console.log('[§207] GREEN radku =', r.rowCount, JSON.stringify(r.rows[0] ?? null).slice(0, 160));
        expect(r.rowCount).toBeGreaterThan(0);
      } finally { c.release(); }
    });
  }, 120_000);

  it('PEEL: projde servisni UPDATE na platform.payouts? (R-30)', async () => {
    await runWithServiceContext(async () => {
      const c = await db().connect();
      try {
        await c.query('BEGIN');
        const u = await c.query(
          `UPDATE platform.payouts SET status = 'failed', failure_reason = 'test' WHERE id = $1`,
          [payoutId],
        );
        await c.query('ROLLBACK');
        console.log('[§207] PEEL UPDATE rowCount =', u.rowCount, u.rowCount === 0 ? '<- R-30 POTVRZENA, dalsi vrstva' : '<- projde');
        // Zamerne se NEasertuje 1 — merí se, co se opravdu stane.
        expect(typeof u.rowCount).toBe('number');
      } finally { c.release(); }
    });
  }, 120_000);

  it('ENABLED_PAYOUT_CHANNELS: paypal vyrazen, wise zustava', () => {
    expect(ENABLED_PAYOUT_CHANNELS.has('paypal')).toBe(false);
    expect(ENABLED_PAYOUT_CHANNELS.has('wise')).toBe(true);
    expect(ENABLED_PAYOUT_CHANNELS.has('bank_transfer')).toBe(true);
    expect(ENABLED_PAYOUT_CHANNELS.has('sepa_credit')).toBe(true);
  });
});
