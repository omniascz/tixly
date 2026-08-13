#!/usr/bin/env node
/**
 * r56-exits-probe.mjs — ZMERIT cesty ven z R-56, ne je implementovat.
 *
 * R-56 (§191): `connect()` nastavuje GUC session-level MIMO transakci; na
 * poolovanem endpointu dorazi dotaz volajiciho na jiny backend. Kandidati:
 *
 *   a) cely pool na NEPOOLED URI     — konfiguracni zmena, nula call sites.
 *      Rozhodujici otazka: kolik soubeznych spojeni direct unese a co se
 *      stane pri prekroceni?
 *   b) nepooled JEN pro connect(), pooled pro query()  — dva pooly.
 *   c) applyGucs() do transakce, kterou otevre connect() sam — co udela
 *      vnoreny BEGIN u volajicich, kteri si BEGIN delaji sami?
 *
 * Metodika u a) a b) je stejna jako §191: n=60 (5 klientu x 12 kol).
 * c) je semanticke mereni, opakuje se 3x.
 *
 *   node scripts/r56-exits-probe.mjs <direct-uri> <pooled-uri> [--cap=N] [--only=ceiling]
 */
import pg from 'pg';

const DIRECT = process.argv[2];
const POOLED = process.argv[3];
const CAP = Number((process.argv.find((a) => a.startsWith('--cap=')) ?? '--cap=700').split('=')[1]);
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '--only=vse').split('=')[1];
if (!DIRECT || !POOLED) { console.error('pouziti: r56-exits-probe.mjs <direct-uri> <pooled-uri> [--cap=N] [--only=ceiling]'); process.exit(2); }

const KEYS = ['app.current_promoter_id', 'app.is_platform_admin', 'app.current_user_id', 'app.role'];
const setSql = (local) =>
  `SELECT ${KEYS.map((_, i) => `set_config($${i + 1}, $${i + 1 + KEYS.length}, ${local}) AS s${i}`).join(', ')}, pg_backend_pid() AS pid`;
const readSql = `SELECT ${KEYS.map((_, i) => `current_setting($${i + 1}, true) AS r${i}`).join(', ')}, pg_backend_pid() AS pid`;
const wantFor = (t) => [`00000000-0000-4000-8000-${String(t).padStart(12, '0')}`, 'true', `00000000-0000-4000-9000-${String(t).padStart(12, '0')}`, `role_${t}`];
const ok = (row, want) => KEYS.every((_, i) => row[`r${i}`] === want[i]);

const line = (s) => console.log(s);
const hdr = (s) => console.log(`\n${'═'.repeat(74)}\n${s}\n${'═'.repeat(74)}`);

// ════════════════════════════════════════════════════════════════════════════
// a) STROP DIRECT ENDPOINTU
// ════════════════════════════════════════════════════════════════════════════
async function ceiling(uri, label, cap = CAP) {
  const c0 = new pg.Client({ connectionString: uri });
  await c0.connect();
  const s = await c0.query(
    "SELECT current_setting('max_connections') AS mx," +
    " current_setting('superuser_reserved_connections') AS res," +
    " (SELECT count(*) FROM pg_stat_activity) AS ted",
  );
  line(`${label}  max_connections=${s.rows[0].mx}  superuser_reserved=${s.rows[0].res}  aktivnich ted=${s.rows[0].ted}`);
  await c0.end();

  const open = [];
  let firstErr = null;
  const BATCH = 20;
  outer: while (open.length < cap) {
    const batch = await Promise.all(
      Array.from({ length: BATCH }, async () => {
        const c = new pg.Client({ connectionString: uri, connectionTimeoutMillis: 10000 });
        try { await c.connect(); await c.query('SELECT 1'); return { c }; }
        catch (e) { await c.end().catch(() => undefined); return { err: e }; }
      }),
    );
    for (const b of batch) {
      if (b.err) { if (!firstErr) firstErr = b.err; break outer; }
      open.push(b.c);
    }
  }
  const n = open.length;
  await Promise.all(open.map((c) => c.end().catch(() => undefined)));
  line(`${label}  otevreno soubezne: ${n}${n >= cap ? ' (strop sondy, ne serveru)' : ''}`);
  if (firstErr) {
    const e = firstErr;
    line(`${label}  pri prekroceni: ${e.code ? `SQLSTATE ${e.code} ` : ''}${String(e.message).slice(0, 120)}`);
  } else {
    line(`${label}  pri prekroceni: nedoslo k nemu do stropu sondy`);
  }
  return { n, err: firstErr };
}

// ════════════════════════════════════════════════════════════════════════════
// Spolecny merak spravnosti kontextu — tvar D2 (connect() + BEGIN volajiciho)
// ════════════════════════════════════════════════════════════════════════════
async function d2(pool, tag) {
  const client = await pool.connect();
  try {
    const want = wantFor(tag);
    await client.query(setSql('false'), [...KEYS, ...want]);   // applyGucs, mimo tx
    await client.query('BEGIN');
    const r = await client.query(readSql, KEYS);
    await client.query('COMMIT');
    return ok(r.rows[0], want);
  } finally { client.release(); }
}
/** Tvar E — jak to dnes dela RlsAwarePool.query(). */
async function e(pool, tag) {
  const client = await pool.connect();
  try {
    const want = wantFor(tag);
    await client.query('BEGIN');
    await client.query(setSql('true'), [...KEYS, ...want]);
    const r = await client.query(readSql, KEYS);
    await client.query('COMMIT');
    return ok(r.rows[0], want);
  } finally { client.release(); }
}
async function measure(pool, fn, clients = 5, rounds = 12) {
  let n = 0, bad = 0;
  for (let round = 0; round < rounds; round++) {
    const res = await Promise.all(Array.from({ length: clients }, (_, i) => fn(pool, round * clients + i + 1).catch(() => false)));
    for (const r of res) { n++; if (!r) bad++; }
  }
  return { n, bad };
}

// ════════════════════════════════════════════════════════════════════════════
// c) VNORENY BEGIN + osud SET LOCAL po COMMITu volajiciho
// ════════════════════════════════════════════════════════════════════════════
async function nestedBegin(uri) {
  const c = new pg.Client({ connectionString: uri });
  const notices = [];
  c.on('notice', (nt) => notices.push(`${nt.severity}: ${nt.message}`));
  await c.connect();
  const state = async () => (await c.query('SELECT current_setting($1, true) AS v', ['app.role'])).rows[0].v;

  // c1: co presne udela vnoreny BEGIN a druhy COMMIT
  notices.length = 0;
  await c.query('BEGIN');
  await c.query('BEGIN');                       // <- vnoreny
  const noticeNested = notices.slice();
  await c.query('COMMIT');
  notices.length = 0;
  await c.query('COMMIT');                      // <- druhy COMMIT
  const noticeSecondCommit = notices.slice();

  // c2: connect() otevre tx + SET LOCAL; volajici pak dela svuj BEGIN/COMMIT
  notices.length = 0;
  await c.query('BEGIN');                                     // connect()
  await c.query("SET LOCAL app.role = 'system'");             // connect()
  await c.query('BEGIN');                                     // volajici (vnoreny)
  const uvnitr = await state();
  await c.query('COMMIT');                                    // volajici
  const poCommitu = await state();
  const dalsiDotaz = await state();

  // c3: a co ROLLBACK volajiciho?
  await c.query('BEGIN');
  await c.query("SET LOCAL app.role = 'system'");
  await c.query('BEGIN');
  await c.query('ROLLBACK');
  const poRollbacku = await state();

  await c.end();
  return { noticeNested, noticeSecondCommit, uvnitr, poCommitu, dalsiDotaz, poRollbacku };
}

// ════════════════════════════════════════════════════════════════════════════
/**
 * d) Spici `SET LOCAL` mimo transakci — `buyer/fan-bonus:18` si nastavuje
 * `app.is_platform_admin='true'` a v cele route neni zadny BEGIN. Otazka:
 * dela to dnes neco, a zacalo by to neco delat, kdyby `connect()` transakci
 * otevrel (kandidat c)?
 */
async function dormantSetLocal(uri) {
  const c = new pg.Client({ connectionString: uri });
  const notices = [];
  c.on('notice', (n) => notices.push(`${n.severity}: ${n.message}`));
  await c.connect();
  const read = async () => (await c.query("SELECT current_setting('app.is_platform_admin', true) AS v")).rows[0].v;

  notices.length = 0;
  await c.query("SET LOCAL app.is_platform_admin = 'true'");   // MIMO transakci
  const mimo = { notice: notices.slice(), hodnota: await read() };

  notices.length = 0;
  await c.query('BEGIN');
  await c.query("SET LOCAL app.is_platform_admin = 'true'");   // UVNITR transakce
  const uvnitr = { notice: notices.slice(), hodnota: await read() };
  await c.query('COMMIT');

  await c.end();
  return { mimo, uvnitr };
}

if (ONLY === 'setlocal') {
  hdr('d) SPICI SET LOCAL: dela dnes neco, a zacal by po oprave?');
  for (let i = 1; i <= 3; i++) {
    const r = await dormantSetLocal(DIRECT);
    line(`opakovani ${i}:`);
    line(`  MIMO transakci : hodnota=${JSON.stringify(r.mimo.hodnota)}  hlasi: ${r.mimo.notice.join(' | ') || '(nic)'}`);
    line(`  UVNITR transakce: hodnota=${JSON.stringify(r.uvnitr.hodnota)}  hlasi: ${r.uvnitr.notice.join(' | ') || '(nic)'}`);
  }
  process.exit(0);
}

hdr(`a) STROP: kolik soubeznych spojeni endpoint unese (strop sondy ${CAP})`);
const capDirect = await ceiling(DIRECT, 'DIRECT');
const capPooled = ONLY === 'ceiling' ? { n: 0 } : await ceiling(POOLED, 'POOLED');

if (ONLY === 'ceiling') {
  hdr('SOUHRN');
  line(`DIRECT strop ~${capDirect.n} spojeni (strop sondy ${CAP})`);
  process.exit(0);
}

hdr('a/b) SPRAVNOST KONTEXTU — n=60 (5 klientu x 12 kol)');
{
  const pd = new pg.Pool({ connectionString: DIRECT, max: 5 });
  const pp = new pg.Pool({ connectionString: POOLED, max: 5 });
  try {
    const a1 = await measure(pd, d2);
    const a2 = await measure(pd, e);
    line(`a) cely pool DIRECT   connect()-tvar (D2): ${a1.bad}/${a1.n} spatne   query()-tvar (E): ${a2.bad}/${a2.n} spatne`);
    const p1 = await measure(pp, d2);
    const p2 = await measure(pp, e);
    line(`   pro srovnani POOLED connect()-tvar (D2): ${p1.bad}/${p1.n} spatne   query()-tvar (E): ${p2.bad}/${p2.n} spatne`);
    line('   ^ self-check: POOLED/D2 MUSI byt nenulove, jinak sonda nemeri to, co tvrdi');

    // b) dva pooly SOUCASNE v jednom procesu
    const bd = measure(pd, d2);
    const bp = measure(pp, e);
    const [rbd, rbp] = await Promise.all([bd, bp]);
    line(`b) dva pooly naraz    connect()->DIRECT: ${rbd.bad}/${rbd.n} spatne   query()->POOLED: ${rbp.bad}/${rbp.n} spatne`);
  } finally {
    await pd.end().catch(() => undefined);
    await pp.end().catch(() => undefined);
  }
}

hdr('c) VNORENY BEGIN — co se opravdu stane (3 opakovani)');
for (let i = 1; i <= 3; i++) {
  const r = await nestedBegin(DIRECT);
  line(`opakovani ${i}:`);
  line(`  vnoreny BEGIN hlasi : ${r.noticeNested.length ? r.noticeNested.join(' | ') : '(nic)'}`);
  line(`  druhy COMMIT hlasi  : ${r.noticeSecondCommit.length ? r.noticeSecondCommit.join(' | ') : '(nic)'}`);
  line(`  app.role uvnitr     : ${JSON.stringify(r.uvnitr)}`);
  line(`  app.role po COMMITu : ${JSON.stringify(r.poCommitu)}   <- SET LOCAL konci s transakci`);
  line(`  app.role dalsi dotaz: ${JSON.stringify(r.dalsiDotaz)}`);
  line(`  app.role po ROLLBACK: ${JSON.stringify(r.poRollbacku)}`);
}

hdr('SOUHRN');
line(`DIRECT strop ~${capDirect.n} spojeni; POOLED strop ~${capPooled.n} (strop sondy 700)`);
