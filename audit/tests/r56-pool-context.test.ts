/**
 * AUDIT R-56: únik session kontextu (set_config GUC) mezi requesty na sdíleném poolu.
 *
 * Běží proti SKUTEČNÉMU src/lib/db/rls-pool.ts. Transakční pooler simuluje
 * PgBouncer (pool_mode=transaction, default_pool_size=2) — stejná třída jako Neon `-pooler`.
 * Aplikace se připojuje jako `tixly_app` (NOBYPASSRLS), takže RLS reálně filtruje.
 *
 * Tři konfigurace (env nastaví runner audit/tools/run-r56.mjs):
 *   R56_MODE=fixed     DATABASE_URL=pooler, DATABASE_URL_DIRECT=přímý PG   (oprava R-56 nasazena správně)
 *   R56_MODE=nodirect  DATABASE_URL=pooler, bez DATABASE_URL_DIRECT, host bez "-pooler"
 *                      → connect() jde na pooler (stav před opravou / chybná konfigurace)
 *   R56_MODE=direct    DATABASE_URL=přímý PG (kontrola)
 *
 * Měří: 60 souběžných "requestů" 30 různých uživatelů; každý v runWithUserContext:
 *   a) connect() + BEGIN + dotaz jako volající (vzor 206 call-sites) → vidí GUC a řádky orders?
 *   b) query() (BEGIN/SET LOCAL/COMMIT uvnitř) → totéž
 * Chyba = GUC patří jinému uživateli / je prázdný, nebo dotaz vrátil CIZÍ objednávku.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

const OWNER = process.env.AUDIT_OWNER_URL as string;
const N_USERS = 30;
const N_REQ = 60;
let owner: Pool;
const users: string[] = [];
const orderOf = new Map<string, string>();

describe(`R-56 pool context (${process.env.R56_MODE})`, () => {
  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER, max: 4 });
    // seed: promoter/venue/event + 30 uživatelů, každý 1 objednávka
    const { makeSeed } = await import('../../nextjs-boilerplate/tests/helpers/live-fixture');
    const seed = makeSeed(owner, `r56${Date.now()}`);
    const chain = await seed.chain();
    for (let i = 0; i < N_USERS; i++) {
      const u = await seed.user(`r56u${i}`);
      const oid = randomUUID();
      await owner.query(
        `INSERT INTO orders.orders (id, user_id, event_id, status, total_amount, currency, expires_at)
         VALUES ($1,$2,$3,'paid',100,'CZK', NOW() + INTERVAL '1 day')`,
        [oid, u.id, chain.eventId],
      );
      users.push(u.id);
      orderOf.set(u.id, oid);
    }
  }, 300_000);

  afterAll(async () => {
    await owner?.end();
    const { db } = await import('@/lib/db/rls-pool');
    await db().end().catch(() => undefined);
  });

  async function probe(kind: 'connect' | 'query') {
    const { db, runWithUserContext } = await import('@/lib/db/rls-pool');
    let wrongGuc = 0, emptyGuc = 0, foreignRows = 0, ownMissing = 0, errors = 0;
    const errSamples: string[] = [];
    await Promise.all(
      Array.from({ length: N_REQ }, (_, i) => {
        const uid = users[i % N_USERS];
        return runWithUserContext(uid, async () => {
          try {
            let guc: string | null; let ids: string[];
            if (kind === 'connect') {
              const c = await db().connect();
              try {
                await c.query('BEGIN');
                await new Promise((r) => setTimeout(r, Math.random() * 15));
                guc = (await c.query(`SELECT current_setting('app.current_user_id', true) AS g`)).rows[0].g;
                ids = (await c.query(`SELECT id FROM orders.orders`)).rows.map((r: { id: string }) => r.id);
                await c.query('COMMIT');
              } finally { c.release(); }
            } else {
              guc = (await db().query(`SELECT current_setting('app.current_user_id', true) AS g`)).rows[0].g as string;
              ids = (await db().query(`SELECT id FROM orders.orders`)).rows.map((r) => (r as { id: string }).id);
            }
            if (!guc) emptyGuc++; else if (guc !== uid) wrongGuc++;
            if (ids.some((x) => x !== orderOf.get(uid))) foreignRows++;
            if (!ids.includes(orderOf.get(uid)!)) ownMissing++;
          } catch (e) {
            errors++; if (errSamples.length < 3) errSamples.push(String((e as Error).message).slice(0, 120));
          }
        });
      }),
    );
    const res = { mode: process.env.R56_MODE, kind, N_REQ, wrongGuc, emptyGuc, foreignRows, ownMissing, errors, errSamples };
    console.log('[R56-RESULT]', JSON.stringify(res));
    return res;
  }

  it('connect() cesta', async () => {
    const r = await probe('connect');
    expect(r.errors + r.wrongGuc + r.emptyGuc + r.foreignRows + r.ownMissing).toBe(0);
  }, 120_000);

  it('query() cesta', async () => {
    const r = await probe('query');
    expect(r.errors + r.wrongGuc + r.emptyGuc + r.foreignRows + r.ownMissing).toBe(0);
  }, 120_000);
});
