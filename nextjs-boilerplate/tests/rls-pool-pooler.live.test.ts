/**
 * R-56 na SKUTECNEM kodu `rls-pool.ts`, ne na kopii jeho tvaru.
 *
 * Puvodne (§191) tenhle test dokladal VADU: `connect()` na poolovanem
 * endpointu bezel pod cizim kontextem (59/60), na primem 0/60.
 * Po zavedeni dvou poolu (kandidat (b), §192) dokladá OPRAVU:
 *
 *   `DATABASE_URL` = POOLOVANY endpoint  (tak, jak to ma produkce)
 *     -> `query()`   jde na nej          -> musi byt 0/60 (tvar E je tesny)
 *     -> `connect()` si odvodi PRIMY     -> musi byt 0/60
 *
 * SELF-CHECK je soucast: kdyz se `DATABASE_URL_DIRECT` natvrdo prepne zpatky
 * na poolovany, `connect()` MUSI zase selhat. Bez toho by 0/60 mohla znamenat
 * jen to, ze sonda nic nemeri (§54).
 *
 * Prepinani endpointu: `db().end()` nuluje OBA lazy pooly a kazdy z nich cte
 * env az pri vytvoreni, takze staci prepsat env a zavolat end().
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createLiveClone, hasNeonKey, type LiveClone } from './helpers/live-fixture';
import { db, runWithUserContext } from '@/lib/db/rls-pool';

const CONCURRENCY = 10;
const ROUNDS = 6;

interface Result { n: number; bad: number; foreign: number; empty: number }

const uid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

/** Vyhodnoti jednu davku vysledku {want, got}. */
function tally(rows: Array<{ want: string; got: string | null }>, out: Result) {
  for (const r of rows) {
    out.n++;
    if (r.got === r.want) continue;
    out.bad++;
    if (r.got === null || r.got === '') out.empty++;
    else out.foreign++;
  }
}

/** Cesta `connect()` — tvar volajiciho podle §120: vlastni BEGIN po connect(). */
async function measureConnect(): Promise<Result> {
  const out: Result = { n: 0, bad: 0, foreign: 0, empty: 0 };
  for (let round = 0; round < ROUNDS; round++) {
    const rows = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) => {
        const want = uid(round * CONCURRENCY + i + 1);
        return runWithUserContext(want, async () => {
          const client = await db().connect();
          try {
            await client.query('BEGIN');
            const r = await client.query("SELECT current_setting('app.current_user_id', true) AS u");
            await client.query('COMMIT');
            return { want, got: (r.rows[0] as { u: string | null }).u };
          } finally { client.release(); }
        }).catch((e: unknown) => ({ want, got: `<chyba: ${String((e as Error)?.message).slice(0, 40)}>` }));
      }),
    );
    tally(rows, out);
  }
  return out;
}

/** Cesta `query()` — RlsAwarePool.query() si BEGIN/SET LOCAL/COMMIT dela sam. */
async function measureQuery(): Promise<Result> {
  const out: Result = { n: 0, bad: 0, foreign: 0, empty: 0 };
  for (let round = 0; round < ROUNDS; round++) {
    const rows = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) => {
        const want = uid(500 + round * CONCURRENCY + i + 1);
        return runWithUserContext(want, async () => {
          const r = await db().query<{ u: string | null }>(
            "SELECT current_setting('app.current_user_id', true) AS u",
          );
          return { want, got: r.rows[0].u };
        }).catch((e: unknown) => ({ want, got: `<chyba: ${String((e as Error)?.message).slice(0, 40)}>` }));
      }),
    );
    tally(rows, out);
  }
  return out;
}

/** Prepne env a zahodi oba pooly, at se vytvori znovu nad novym URI. */
async function prepni(databaseUrl: string, direct?: string) {
  await db().end().catch(() => undefined);
  process.env.DATABASE_URL = databaseUrl;
  if (direct) process.env.DATABASE_URL_DIRECT = direct;
  else delete process.env.DATABASE_URL_DIRECT;
}

describe.skipIf(!hasNeonKey)('R-56 — dva pooly: connect() primy, query() poolovany', () => {
  let clone: LiveClone;
  let directUri: string;
  let pooledUri: string;

  beforeAll(async () => {
    // Zadne migrace — meri se chovani spojeni, ne schema.
    clone = await createLiveClone('r56-dva-pooly', { migrations: [] });
    directUri = process.env.DATABASE_URL as string;   // fixture vynucuje pooled=false
    pooledUri = directUri.replace(/@([^.@/]+)\./, '@$1-pooler.');
    expect(pooledUri).not.toBe(directUri);
  }, 180_000);

  afterAll(async () => {
    await db().end().catch(() => undefined);
    delete process.env.DATABASE_URL_DIRECT;
    await clone?.cleanup();
  }, 120_000);

  it('SELF-CHECK: kdyz se connect() vrati na POOLOVANY, musi zase selhat', async () => {
    // DATABASE_URL_DIRECT natvrdo na pooler = odvozeni se obejde
    await prepni(pooledUri, pooledUri);
    const r = await measureConnect();
    console.log('[R-56] self-check (connect na POOLERU)', JSON.stringify(r));
    expect(r.bad).toBeGreaterThan(0);
  }, 180_000);

  it('OPRAVA: DATABASE_URL = pooler -> connect() 0/60 i query() 0/60', async () => {
    await prepni(pooledUri);              // zadny DATABASE_URL_DIRECT -> odvodi se
    const c = await measureConnect();
    const q = await measureQuery();
    console.log('[R-56] connect() (odvozeny direct)', JSON.stringify(c));
    console.log('[R-56] query()   (pooler)         ', JSON.stringify(q));
    expect(c.n).toBe(CONCURRENCY * ROUNDS);
    expect(c.bad).toBe(0);
    expect(q.n).toBe(CONCURRENCY * ROUNDS);
    expect(q.bad).toBe(0);
  }, 240_000);

  it('odvozeni direct URI z pooled hostu opravdu odstrani -pooler', () => {
    // Chovani `directUrl()` bez importu privatni funkce — tentyz vzor.
    const odvozeny = pooledUri.replace(/@([^.@/]+)-pooler\./, '@$1.');
    expect(odvozeny).toBe(directUri);
    // A na uz primem URI je to no-op (idempotence).
    expect(directUri.replace(/@([^.@/]+)-pooler\./, '@$1.')).toBe(directUri);
  });
});
