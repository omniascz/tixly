/**
 * R-15: mechanismus zmereny na SKUTECNEM kodu `rls-pool.ts`, ne na kopii tvaru.
 *
 * `scripts/guc-swap-probe.mjs` (§191) zmerilo, ze session GUC nastavene MIMO
 * transakci se na poolovanem endpointu nedrzi u volajiciho. Ta sonda ale
 * replikovala tvar dotazu rucne. Tenhle test pousti `db().connect()` +
 * `runWithUserContext` z produkcniho modulu — kdyby se sonda a realny kod
 * v necem lisily, vyjde to najevo tady.
 *
 * Oba endpointy TEHOZ klonu, aby rozdil nesel svest na jina data.
 * Prepinani endpointu: `db().end()` nuluje lazy pool (rls-pool.ts:300) a
 * `getRawPool()` cte `DATABASE_URL` az pri vytvoreni (rls-pool.ts:49), takze
 * staci prepsat env a zavolat end(). Zadny re-import.
 *
 * SELF-CHECK je soucast testu: direct endpoint MUSI vyjit ciste. Kdyby vysly
 * spatne oba, test nemeri endpoint, ale neco jineho, a cislo z pooleru neplati.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createLiveClone, hasNeonKey, type LiveClone } from './helpers/live-fixture';
import { db, runWithUserContext } from '@/lib/db/rls-pool';

const CONCURRENCY = 10;
const ROUNDS = 6;

interface Result { n: number; bad: number; foreign: number; empty: number }

async function measure(uri: string): Promise<Result> {
  await db().end().catch(() => undefined);   // zahodi pool nad predchozim URI
  process.env.DATABASE_URL = uri;

  const out: Result = { n: 0, bad: 0, foreign: 0, empty: 0 };
  try {
    for (let round = 0; round < ROUNDS; round++) {
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, i) => {
          const uid = `00000000-0000-4000-8000-${String(round * CONCURRENCY + i + 1).padStart(12, '0')}`;
          return runWithUserContext(uid, async () => {
            const client = await db().connect();
            try {
              // Tvar volajiciho podle §120: vlastni BEGIN az po `connect()`.
              await client.query('BEGIN');
              const r = await client.query("SELECT current_setting('app.current_user_id', true) AS u");
              await client.query('COMMIT');
              return { want: uid, got: (r.rows[0] as { u: string | null }).u };
            } finally {
              client.release();
            }
          }).catch((e: unknown) => ({ want: uid, got: `<chyba: ${String((e as Error)?.message).slice(0, 40)}>` }));
        }),
      );
      for (const r of results) {
        out.n++;
        if (r.got === r.want) continue;
        out.bad++;
        if (r.got === null || r.got === '') out.empty++;
        else out.foreign++;
      }
    }
  } finally {
    await db().end().catch(() => undefined);
  }
  return out;
}

describe.skipIf(!hasNeonKey)('R-15: pooled vs direct endpoint na realnem rls-pool', () => {
  let clone: LiveClone;
  let directUri: string;
  let pooledUri: string;

  beforeAll(async () => {
    // Zadne migrace — meri se chovani spojeni, ne schema.
    clone = await createLiveClone('r15-pooler', { migrations: [] });
    directUri = process.env.DATABASE_URL as string;  // fixture uz nastavila (tixly_app)
    pooledUri = directUri.replace(/@([^.@]+)\./, '@$1-pooler.');
    expect(pooledUri).not.toBe(directUri);
  }, 180_000);

  afterAll(async () => {
    await clone?.cleanup();
  }, 120_000);

  it('SELF-CHECK: direct endpoint drzi vlastni kontext', async () => {
    const direct = await measure(directUri);
    console.log('[R-15] DIRECT', JSON.stringify(direct));
    expect(direct.n).toBe(CONCURRENCY * ROUNDS);
    expect(direct.bad).toBe(0);
  }, 180_000);

  it('POOLED endpoint: connect() ztrati vlastni kontext', async () => {
    const pooled = await measure(pooledUri);
    console.log('[R-15] POOLED', JSON.stringify(pooled));
    // Zamerne se netvrdi konkretni pomer — je to zavod, ne konstanta.
    // Tvrdi se jen to, co je pro nasazeni podstatne: NENI to nula.
    expect(pooled.bad).toBeGreaterThan(0);
  }, 180_000);
});
