#!/usr/bin/env node
/**
 * guc-swap-probe.mjs — ZMERIT mechanismus R-15: ztratu VLASTNIHO GUC.
 *
 * ── Cim se lisi od `guc-leak-probe.mjs` ──────────────────────────────────────
 * Ten meri PROSAKOVANI: dostal jsem cizi GUC? (kontaminace)
 * Tenhle meri ZTRATU:   dostal jsem svuj vlastni GUC? (R-15)
 *
 * R-15 symptom (§116, §117): `setPid=778 queryPid=781 shoda=FALSE role=null
 * radku=0` — vsechny ctyri GUC jsou null a dotaz vrati 0 radku. Neni to cizi
 * GUC, je to CHYBEJICI VLASTNI. Zadny ze scenaru A/B/C tuhle tridu nemeri.
 *
 * ── Co presne se replikuje ───────────────────────────────────────────────────
 * `rls-pool.ts:216 connect()` -> `applyGucs()` (radek 159) dela
 * `set_config($n, $m, false)` = SESSION-level, MIMO transakci, a hned si to
 * precte v TEMZE statementu (proto §121 namerilo MISMATCH=0 — jeden statement
 * je vzdy na jednom backendu). Volajici pak posle SVUJ dotaz jako SAMOSTATNY
 * statement. Na pooleru v transaction mode je prave tady okno: backend se
 * prirazuje per transakci, a samostatny statement = vlastni transakce.
 *
 * ── Scenare ──────────────────────────────────────────────────────────────────
 *   D  connect() jak je dnes: set_config(...,false) mimo tx -> SAMOSTATNY dotaz
 *   E  navrhovana oprava:     BEGIN / SET LOCAL / dotaz / COMMIT
 *   Z  SELF-CHECK (pozitivni kontrola): GUC se nastavi na klientu A a cte na
 *      klientu B. Ztrata tam MUSI byt videt na OBOU endpointech. Kdyz Z hlasi
 *      nulu, sonda je slepa a cisla z D/E NEPLATI.
 *
 * Soubeh je podminka: s jedinym klientem si pooler backend drzi. Produkce ma
 * soubeznych requestu vic, proto `--clients`.
 *
 *   node scripts/guc-swap-probe.mjs <connection-uri> [--clients=10] [--rounds=8]
 */
import pg from 'pg';

const URI = process.argv[2];
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? Number(hit.split('=')[1]) : d;
};
const CLIENTS = arg('clients', 10);
const ROUNDS = arg('rounds', 8);
if (!URI) {
  console.error('pouziti: node scripts/guc-swap-probe.mjs <uri> [--clients=N] [--rounds=N]');
  process.exit(2);
}

const KEYS = ['app.current_promoter_id', 'app.is_platform_admin', 'app.current_user_id', 'app.role'];

/** Presna kopie tvaru z rls-pool.ts:159 — set_config + read-back v JEDNOM statementu. */
function applyGucsSql() {
  const sets = KEYS.map((_, i) => `set_config($${i + 1}, $${i + 1 + KEYS.length}, false) AS s${i}`);
  return `SELECT ${sets.join(', ')}, pg_backend_pid() AS pid`;
}
const readSql = `SELECT ${KEYS.map((_, i) => `current_setting($${i + 1}, true) AS r${i}`).join(', ')}, pg_backend_pid() AS pid`;

/** Hodnoty jsou per-worker unikatni, at je poznat i zamena za CIZI kontext. */
const wantFor = (tag) => [`00000000-0000-4000-8000-${String(tag).padStart(12, '0')}`, 'true', `00000000-0000-4000-9000-${String(tag).padStart(12, '0')}`, `role_${tag}`];

/**
 * Rozlisuje TRI vysledky, protoze maji uplne jiny dopad:
 *   vlastni — GUC sedi         -> v poradku
 *   prazdno — vsechny null/''  -> fail-closed (routa vrati 0 radku)
 *   CIZI    — nenulove, ale patri JINEMU workeru -> dotaz bezi pod cizim
 *             tenantem. To NENI tiche prazdno, to je zamena kontextu.
 * Tag je zasity v hodnote `app.role` = `role_<tag>`, takze jde poznat, ci to je.
 */
function classify(row, want, setPid, tag) {
  const got = KEYS.map((_, i) => row[`r${i}`]);
  const empty = got.every((v) => v === null || v === '');
  const same = Number(row.pid) === setPid;
  const exact = got.every((v, i) => v === want[i]);
  const roleSeen = row[`r${KEYS.indexOf('app.role')}`];
  const foreign = !exact && !empty && typeof roleSeen === 'string' && roleSeen !== '' && roleSeen !== `role_${tag}`;
  return { empty, same, exact, foreign, gotPid: Number(row.pid), roleSeen };
}

/** D: dnesni connect() — session GUC mimo transakci, pak samostatny dotaz. */
async function scenarioD(pool, tag) {
  const client = await pool.connect();
  try {
    const want = wantFor(tag);
    const s = await client.query(applyGucsSql(), [...KEYS, ...want]);
    const setPid = Number(s.rows[0].pid);
    const r = await client.query(readSql, KEYS);
    return classify(r.rows[0], want, setPid, tag);
  } finally {
    client.release();
  }
}

/**
 * D2: REALNY tvar volajiciho `connect()`. Podle §120 si 161 ze 176 volajicich
 * otevira VLASTNI `BEGIN`. GUC ale nastavil `connect()` uz PREDTIM, mimo tu
 * transakci — tohle meri, jestli to transakci volajiciho zachrani.
 */
async function scenarioD2(pool, tag) {
  const client = await pool.connect();
  try {
    const want = wantFor(tag);
    const s = await client.query(applyGucsSql(), [...KEYS, ...want]);
    const setPid = Number(s.rows[0].pid);
    await client.query('BEGIN');
    const r = await client.query(readSql, KEYS);
    await client.query('COMMIT');
    return classify(r.rows[0], want, setPid, tag);
  } finally {
    client.release();
  }
}

/** E: oprava — SET LOCAL a dotaz v jedne transakci. */
async function scenarioE(pool, tag) {
  const client = await pool.connect();
  try {
    const want = wantFor(tag);
    await client.query('BEGIN');
    const s = await client.query(
      `SELECT ${KEYS.map((_, i) => `set_config($${i + 1}, $${i + 1 + KEYS.length}, true) AS s${i}`).join(', ')}, pg_backend_pid() AS pid`,
      [...KEYS, ...want],
    );
    const setPid = Number(s.rows[0].pid);
    const r = await client.query(readSql, KEYS);
    await client.query('COMMIT');
    return classify(r.rows[0], want, setPid, tag);
  } finally {
    client.release();
  }
}

/**
 * Z: SELF-CHECK (pozitivni kontrola). Drzi DVA ruzne klienty soucasne — nastavi
 * na A, cte na B. Dve soubezne spojeni jsou na direct endpointu vzdy dva ruzne
 * backendy, takze ztrata TAM MUSI byt videt. Prvni verze klienta A pred ctenim
 * pustila, cimz ho pool vratil zpatky jako B — self-check pak na direct hlasil
 * nulu a byl slepy. Proto se drzi oba naraz.
 */
async function scenarioZ(pool, tag) {
  const a = await pool.connect();
  const b = await pool.connect();
  try {
    const want = wantFor(tag);
    const s = await a.query(applyGucsSql(), [...KEYS, ...want]);
    const setPid = Number(s.rows[0].pid);
    const r = await b.query(readSql, KEYS);
    return classify(r.rows[0], want, setPid, tag);
  } finally {
    a.release();
    b.release();
  }
}

async function run(name, fn, maxClients = CLIENTS) {
  const pool = new pg.Pool({ connectionString: URI, max: maxClients });
  const agg = { n: 0, empty: 0, foreign: 0, pidSwap: 0, bad: 0, err: 0, backends: new Set() };
  try {
    for (let round = 0; round < ROUNDS; round++) {
      const res = await Promise.all(
        Array.from({ length: CLIENTS }, (_, i) => fn(pool, round * CLIENTS + i + 1).catch((e) => ({ err: String(e.message ?? e) }))),
      );
      for (const r of res) {
        agg.n++;
        if (r.err) { agg.err++; continue; }
        if (r.empty) agg.empty++;
        if (r.foreign) agg.foreign++;
        if (!r.same) agg.pidSwap++;
        if (!r.exact) agg.bad++;
        agg.backends.add(r.gotPid);
      }
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
  console.log(
    `${name.padEnd(44)} n=${String(agg.n).padStart(3)}` +
    `  spatne=${String(agg.bad).padStart(3)}  z toho PRAZDNO=${String(agg.empty).padStart(3)}` +
    `  CIZI=${String(agg.foreign).padStart(3)}  pid_zmena=${String(agg.pidSwap).padStart(3)}` +
    `  backendu=${agg.backends.size}${agg.err ? `  chyb=${agg.err}` : ''}`,
  );
  return agg;
}

const pooled = /-pooler\./.test(URI);
console.log(`endpoint: ${pooled ? 'POOLED (-pooler)' : 'DIRECT (pooled=false)'}   clients=${CLIENTS} rounds=${ROUNDS}`);
const z = await run('Z self-check (set na A, cti na B) — MUSI najit', scenarioZ, CLIENTS * 2 + 2);
const d = await run('D connect() dnes: session GUC mimo transakci', scenarioD);
const d2 = await run('D2 connect() + vlastni BEGIN volajiciho', scenarioD2);
const e = await run('E oprava: BEGIN / SET LOCAL / dotaz / COMMIT', scenarioE);

console.log('');
if (z.bad === 0) {
  console.log('SELF-CHECK SELHAL: scenar Z nenasel ztratu ani jednou -> sonda je SLEPA, cisla D/D2/E NEPLATI.');
  process.exit(3);
}
console.log(`SELF-CHECK OK: Z nasel ztratu ${z.bad}/${z.n}x -> detektor tuhle tridu umi najit.`);
console.log(`ZAVER: D=${d.bad}/${d.n}  D2=${d2.bad}/${d2.n}  E=${e.bad}/${e.n}` +
  `   (cizi kontext: D=${d.foreign}, D2=${d2.foreign}, E=${e.foreign})`);
