// @vitest-environment node
/**
 * Kolo 2 / krok 4 — V9 / R-56: únik RLS kontextu (GUC) mezi requesty na sdíleném poolu.
 *
 * Audit: oprava R-56 fungovala jen, když se podařilo odvodit přímé připojení
 * (`DATABASE_URL_DIRECT` nebo host s `-pooler.`); jinak `connect()` na transakčním pooleru
 * vidělo cizí kontext (40/60 requestů cizí objednávky).
 *
 * Požadavek: kontext platí jen v rámci transakce, ve VŠECH poolech, BEZ podmínky.
 * Test: aplikace mluví na PgBouncer v transaction módu (default_pool_size=2 → backendy se
 * střídají mezi klienty), BEZ DATABASE_URL_DIRECT a s hostem bez `-pooler`. 200 souběžných
 * requestů střídá 100 uživatelů a 10 pořadatelů (tenantů) přes tři vzory použití poolu:
 *   query()                      — db().query
 *   connect()+BEGIN…COMMIT       — explicitní transakce (vzor ~200 call-sites)
 *   connect() bez BEGIN          — autocommit dotazy na vypůjčeném klientovi
 * Každý request ověří GUC i řádky: 0 požadavků smí vidět cizí data / cizí kontext.
 *
 * Gate: FIX_E2E=1 a FIX_PGBOUNCER_URL (např. postgresql://tixly_app:fixapp@localhost:56633/e2e).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';

const PGB = process.env.FIX_PGBOUNCER_URL;
const run = describe.skipIf(!hasLocalDb || !PGB);
const N_USERS = 100;
const N_TENANTS = 10;
const N_REQ = 200;

run('Krok 4 — R-56: kontext jen v transakci, na pooleru bez DATABASE_URL_DIRECT', () => {
  let clone: LocalClone;
  const users: string[] = [];
  const orderOfUser = new Map<string, string>();
  const tenants: string[] = [];
  const ordersOfTenant = new Map<string, Set<string>>();

  beforeAll(async () => {
    clone = await createLocalClone(`r56${Date.now()}`);
    // aplikace MUSÍ jít přes transakční pooler a NESMÍ mít přímé URL
    process.env.DATABASE_URL = PGB!;
    delete process.env.DATABASE_URL_DIRECT;
    process.env.PG_POOL_MAX = '8';
    for (let t = 0; t < N_TENANTS; t++) {
      const c = await clone.seed.chain();
      tenants.push(c.promoterId);
      ordersOfTenant.set(c.promoterId, new Set());
      for (let k = 0; k < N_USERS / N_TENANTS; k++) {
        const u = await clone.seed.user(`r56u${t}_${k}`);
        const oid = randomUUID();
        await clone.pool.query(
          `INSERT INTO orders.orders (id, user_id, event_id, status, total_amount, currency, expires_at)
           VALUES ($1,$2,$3,'paid',100,'CZK', NOW() + INTERVAL '1 day')`, [oid, u.id, c.eventId]);
        users.push(u.id);
        orderOfUser.set(u.id, oid);
        ordersOfTenant.get(c.promoterId)!.add(oid);
      }
    }
  }, 300_000);
  afterAll(async () => { await clone?.cleanup(); }, 60_000);

  type Kind = 'query' | 'connect-tx' | 'connect-autocommit';
  async function probe(kind: Kind) {
    const { db, runWithUserContext, runWithPromoterContext } = await import('@/lib/db/rls-pool');
    let bad = 0, errors = 0;
    const samples: string[] = [];
    const sleep = () => new Promise((r) => setTimeout(r, Math.random() * 10));
    await Promise.all(Array.from({ length: N_REQ }, async (_, i) => {
      const isUser = i % 2 === 0;
      const uid = users[(i / 2) % N_USERS | 0];
      const pid = tenants[i % N_TENANTS];
      const gucName = isUser ? 'app.current_user_id' : 'app.current_promoter_id';
      const expectGuc = isUser ? uid : pid;
      const expectRows = isUser ? new Set([orderOfUser.get(uid)!]) : ordersOfTenant.get(pid)!;
      const body = async () => {
        let guc: string | null; let ids: string[];
        if (kind === 'query') {
          guc = (await db().query<{ g: string }>(`SELECT current_setting($1, true) AS g`, [gucName])).rows[0].g;
          await sleep();
          ids = (await db().query<{ id: string }>(`SELECT id FROM orders.orders`)).rows.map((r) => r.id);
        } else {
          const c = await db().connect();
          try {
            if (kind === 'connect-tx') await c.query('BEGIN');
            await sleep();
            guc = (await c.query(`SELECT current_setting($1, true) AS g`, [gucName])).rows[0].g;
            await sleep();
            ids = (await c.query(`SELECT id FROM orders.orders`)).rows.map((r: { id: string }) => r.id);
            if (kind === 'connect-tx') await c.query('COMMIT');
          } finally { c.release(); }
        }
        const foreign = ids.filter((x) => !expectRows.has(x));
        const missing = [...expectRows].filter((x) => !ids.includes(x));
        if (guc !== expectGuc || foreign.length || missing.length) {
          bad++;
          if (samples.length < 3) samples.push(JSON.stringify({ i, isUser, gucOk: guc === expectGuc, foreign: foreign.length, missing: missing.length }));
        }
      };
      try {
        await (isUser ? runWithUserContext(uid, body) : runWithPromoterContext(pid, body));
      } catch (e) {
        errors++;
        if (samples.length < 3) samples.push(String((e as Error).message).slice(0, 120));
      }
    }));
    const res = { kind, N_REQ, bad, errors, samples };
    console.log('[R56]', JSON.stringify(res));
    return res;
  }

  for (const kind of ['query', 'connect-tx', 'connect-autocommit'] as Kind[]) {
    it(`${kind}: 200 souběžných requestů (100 uživatelů / 10 tenantů) → 0 vidí cizí data`, async () => {
      const r = await probe(kind);
      expect(r.errors, r.samples.join(' | ')).toBe(0);
      expect(r.bad, r.samples.join(' | ')).toBe(0);
    }, 180_000);
  }

  it('po vrácení do poolu nenese spojení žádný kontext (dotaz bez kontextu nevidí nic)', async () => {
    const { db } = await import('@/lib/db/rls-pool');
    const rows = await Promise.all(Array.from({ length: 40 }, () => db().query<{ u: string | null; p: string | null; n: number }>(
      `SELECT NULLIF(current_setting('app.current_user_id', true),'') u, NULLIF(current_setting('app.current_promoter_id', true),'') p,
              (SELECT count(*)::int FROM orders.orders) n`)));
    for (const r of rows) expect(r.rows[0]).toEqual({ u: null, p: null, n: 0 });
  }, 60_000);
});
