// @vitest-environment node
/**
 * Kolo 3 / krok 0 — regrese kola 2 (R-56): vnořené výpůjčky z poolu pod souběhem.
 *
 * Auditní E2E 05 po kole 2: 98/100 souběžných checkoutů 500 „timeout exceeded when trying to
 * connect". Příčina: oprava R-56 sloučila connect() a query() do JEDNOHO poolu. Checkout (a další
 * routy) drží klienta z connect() v transakci a uvnitř volá db().query() → každý request potřebuje
 * DVĚ spojení ze stejného poolu; při souběhu všichni drží jedno a čekají na druhé → deadlock.
 *
 * Test: pool velikosti 4, 12 souběžných „requestů", každý drží connect() klienta v transakci a
 * uvnitř volá db().query(). Všechny musí doběhnout bez chyby. Kontext (R-56) musí zůstat těsný.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';

const run = describe.skipIf(!hasLocalDb);

run('Krok 0 (kolo 3) — vnořené výpůjčky connect() + query() pod souběhem', () => {
  let clone: LocalClone;
  const users: string[] = [];
  const orderOf = new Map<string, string>();

  beforeAll(async () => {
    clone = await createLocalClone();
    process.env.PG_POOL_MAX = '4';
    process.env.PG_DIRECT_POOL_MAX = '4';
    const c = await clone.seed.chain();
    for (let i = 0; i < 12; i++) {
      const u = await clone.seed.user(`nest${i}`);
      const oid = randomUUID();
      await clone.pool.query(`INSERT INTO orders.orders (id, user_id, event_id, status, total_amount, currency, expires_at)
                              VALUES ($1,$2,$3,'paid',100,'CZK', now()+interval '1 day')`, [oid, u.id, c.eventId]);
      users.push(u.id); orderOf.set(u.id, oid);
    }
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 60_000);

  it('12 souběžných requestů (pool 4), každý drží transakci a vnořeně volá db().query() → 0 chyb, kontext těsný', async () => {
    const { db, runWithUserContext } = await import('@/lib/db/rls-pool');
    const errors: string[] = []; let bad = 0;
    await Promise.all(users.map((uid) => runWithUserContext(uid, async () => {
      try {
        const c = await db().connect();
        try {
          await c.query('BEGIN');
          const inTx = (await c.query<{ id: string }>(`SELECT id FROM orders.orders`)).rows.map((r) => r.id);
          await new Promise((r) => setTimeout(r, 50));
          const nested = (await db().query<{ id: string }>(`SELECT id FROM orders.orders`)).rows.map((r) => r.id);
          await c.query('COMMIT');
          const want = [orderOf.get(uid)];
          if (JSON.stringify(inTx) !== JSON.stringify(want) || JSON.stringify(nested) !== JSON.stringify(want)) bad++;
        } finally { c.release(); }
      } catch (e) { errors.push((e as Error).message); }
    })));
    expect(errors, errors.slice(0, 3).join(' | ')).toEqual([]);
    expect(bad).toBe(0);
  }, 60_000);
});
