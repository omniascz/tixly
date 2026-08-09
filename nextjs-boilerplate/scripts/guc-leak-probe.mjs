#!/usr/bin/env node
/**
 * guc-leak-probe.mjs — ZMERIT, ne odhadnout, jak GUC prosakuje mezi mereními.
 *
 * §186 pozorovalo, ze cerstvy `new Client()` precetl `app.is_platform_admin='true'`,
 * ktere nastavil nekdo pred nim. Na skutecne novem backendu to nejde — takze bud
 * Neon proxy recykluje compute spojeni, nebo prosakuje pg.Pool pres release().
 * Tohle rozlisi ktere.
 *
 * Tri scenare:
 *   A) novy Client -> SET -> end;  novy Client -> read       (prosakuje endpoint?)
 *   B) pool.connect -> SET -> release; connect -> read        (prosakuje pg.Pool?)
 *   C) pool.connect -> BEGIN/SET LOCAL/COMMIT -> release; connect -> read (oprava)
 *
 *   node scripts/guc-leak-probe.mjs <connection-uri> [opakovani]
 */
import pg from 'pg';

const URI = process.argv[2];
const N = Number(process.argv[3] ?? 8);
if (!URI) { console.error('chybi connection uri'); process.exit(2); }

// Kazdy scenar ma VLASTNI priznak. Se sdilenym by scenar B zamoril backend a
// scenar C by cetl jeho zbytek — sam by pak vypadal jako netesny.
const read = async (c, flag) =>
  (await c.query(`SELECT current_setting('app.${flag}', true) AS v, pg_backend_pid() AS pid`)).rows[0];

async function scenarioA() {
  let leaked = 0; const pids = new Set();
  for (let i = 0; i < N; i++) {
    const w = new pg.Client({ connectionString: URI });
    await w.connect();
    await w.query("SET app.probe_a = 'ANO'");
    pids.add((await read(w, 'probe_a')).pid);
    await w.end();

    const r = new pg.Client({ connectionString: URI });
    await r.connect();
    const got = await read(r, 'probe_a');
    pids.add(got.pid);
    await r.end();
    if (got.v === 'ANO') leaked++;
  }
  return { leaked, backends: pids.size };
}

async function scenarioB(useLocal, flag) {
  const pool = new pg.Pool({ connectionString: URI, max: 2 });
  let leaked = 0;
  for (let i = 0; i < N; i++) {
    const w = await pool.connect();
    if (useLocal) {
      await w.query('BEGIN');
      await w.query(`SET LOCAL app.${flag} = 'ANO'`);
      await w.query('COMMIT');
    } else {
      await w.query(`SET app.${flag} = 'ANO'`);
    }
    w.release();

    const r = await pool.connect();
    const got = await read(r, flag);
    r.release();
    if (got.v === 'ANO') leaked++;
  }
  await pool.end();
  return leaked;
}

const a = await scenarioA();
console.log(`A) novy Client po novem Clientu : prosaklo ${a.leaked}/${N}  (ruznych backendu: ${a.backends})`);
console.log(`B) pg.Pool, holy SET            : prosaklo ${await scenarioB(false, 'probe_b')}/${N}`);
console.log(`C) pg.Pool, SET LOCAL v tranz.  : prosaklo ${await scenarioB(true, 'probe_c')}/${N}`);
