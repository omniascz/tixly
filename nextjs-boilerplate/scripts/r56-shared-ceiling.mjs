#!/usr/bin/env node
/**
 * r56-shared-ceiling.mjs — sdili direct a pooled endpoint TYZ strop?
 *
 * §192 zmerilo, ze direct unese 890 spojeni a 891. spadne na 53300. Kandidat
 * (b) ale chce oba endpointy najednou, takze je potreba vedet:
 *   1. Kolik BACKENDU spotrebuje N klientskych spojeni na pooleru?
 *      (Na direct je to 1:1. Na pooleru ne — PgBouncer ma vlastni server pool.)
 *   2. Kdyz direct pool vycerpa sloty, prestane fungovat i pooled cesta?
 *
 * Druha otazka je ta rozhodujici: kdyby ano, direct pool muze vyhladovet
 * pooled cestu a (b) potrebuje strop u obou.
 *
 *   node scripts/r56-shared-ceiling.mjs <direct-uri> <pooled-uri>
 */
import pg from 'pg';

const DIRECT = process.argv[2];
const POOLED = process.argv[3];
if (!DIRECT || !POOLED) { console.error('pouziti: <direct-uri> <pooled-uri>'); process.exit(2); }

const line = (s) => console.log(s);
const hdr = (s) => console.log(`\n${'═'.repeat(72)}\n${s}\n${'═'.repeat(72)}`);

const openMany = async (uri, n, batch = 25) => {
  const out = []; let err = null;
  outer: while (out.length < n) {
    const k = Math.min(batch, n - out.length);
    const res = await Promise.all(Array.from({ length: k }, async () => {
      const c = new pg.Client({ connectionString: uri, connectionTimeoutMillis: 15000 });
      try { await c.connect(); await c.query('SELECT 1'); return { c }; }
      catch (e) { await c.end().catch(() => undefined); return { e }; }
    }));
    for (const r of res) { if (r.e) { err = r.e; break outer; } out.push(r.c); }
  }
  return { clients: out, err };
};
const closeAll = (cs) => Promise.all(cs.map((c) => c.end().catch(() => undefined)));

/** Kolik backendu je videt z nezavisleho direct spojeni. */
async function backends(uri) {
  const c = new pg.Client({ connectionString: uri });
  await c.connect();
  const r = await c.query(
    "SELECT count(*)::int AS vse," +
    " count(*) FILTER (WHERE backend_type='client backend')::int AS klientske" +
    " FROM pg_stat_activity",
  );
  await c.end();
  return r.rows[0];
}

/**
 * 0) Cena reconnectu. Doporuceni „zkrat idleTimeoutMillis u direct poolu" ma
 * cenu jen tehdy, kdyz se vi, co stoji navazani noveho spojeni proti pouziti
 * uz otevreneho. Bez tohohle cisla je to dohad.
 */
async function reconnectCost(uri, label, n = 12) {
  const fresh = [];
  for (let i = 0; i < n; i++) {
    const t = process.hrtime.bigint();
    const c = new pg.Client({ connectionString: uri });
    await c.connect();
    await c.query('SELECT 1');
    fresh.push(Number(process.hrtime.bigint() - t) / 1e6);
    await c.end();
  }
  const pool = new pg.Pool({ connectionString: uri, max: 1 });
  await (await pool.connect()).release();          // zahrat
  const reused = [];
  for (let i = 0; i < n; i++) {
    const t = process.hrtime.bigint();
    const c = await pool.connect();
    await c.query('SELECT 1');
    c.release();
    reused.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  await pool.end();
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  line(`${label}  nove spojeni median ${med(fresh).toFixed(0)} ms   z poolu median ${med(reused).toFixed(0)} ms` +
    `   rozdil ${(med(fresh) - med(reused)).toFixed(0)} ms`);
}

if ((process.argv.find((a) => a.startsWith('--only=')) ?? '').includes('reconnect')) {
  hdr('0) CENA RECONNECTU (medián z 12)');
  await reconnectCost(DIRECT, 'DIRECT');
  await reconnectCost(POOLED, 'POOLED');
  process.exit(0);
}

/**
 * 3) VYHLADOVENI. §194 zmerilo, ze pri vycerpanem directu pooled spojeni PROSLO —
 * ale jen proto, ze PgBouncer uz backend mel a recykloval ho. Otazka, ktera
 * zustala NEZODPOVEZENA: co udela, kdyz potrebuje NOVY backend a slot neni?
 *
 * Aby musel otevrit nove, pusti se soubezne dotazy, ktere nejdou serializovat
 * na jeden backend (`pg_sleep`), a je jich vic nez kolik ma pooler navazano.
 * Merí se, jestli to selze TVRDE (chyba) nebo jen ceka (fronta).
 */
async function starve(direct, pooled) {
  // pooler zahrat co nejmene — jen jedno spojeni, at ma minimum backendu
  const warm = new pg.Client({ connectionString: pooled });
  await warm.connect(); await warm.query('SELECT 1');
  const before = await backends(direct);
  line(`pred vycerpanim: ${JSON.stringify(before)}`);

  const held = await openMany(direct, 895);
  line(`drzim direct: ${held.clients.length}  (dalsi -> ${held.err?.code ?? 'bez chyby'})`);

  const N = 40;
  const t0 = Date.now();
  const res = await Promise.all(Array.from({ length: N }, async (_, i) => {
    const c = new pg.Client({ connectionString: pooled, connectionTimeoutMillis: 20000 });
    const t = Date.now();
    try {
      await c.connect();
      await c.query('SELECT pg_sleep(0.5)');
      await c.end();
      return { ok: true, ms: Date.now() - t };
    } catch (e) {
      await c.end().catch(() => undefined);
      return { ok: false, ms: Date.now() - t, code: e.code, msg: String(e.message).slice(0, 70) };
    }
  }));
  const ok = res.filter((r) => r.ok);
  const bad = res.filter((r) => !r.ok);
  line(`${N} soubeznych POOLED dotazu pri vycerpanem directu:`);
  line(`  proslo ${ok.length}, selhalo ${bad.length}, celkem ${Date.now() - t0} ms`);
  if (ok.length) {
    const ms = ok.map((r) => r.ms).sort((a, b) => a - b);
    line(`  doba u uspesnych: min ${ms[0]} ms, median ${ms[Math.floor(ms.length / 2)]} ms, max ${ms[ms.length - 1]} ms`);
  }
  for (const b of [...new Set(bad.map((r) => `${r.code} ${r.msg}`))]) line(`  chyba: ${b}`);
  await closeAll(held.clients);
  await warm.end().catch(() => undefined);
  return { ok: ok.length, bad: bad.length };
}

if ((process.argv.find((a) => a.startsWith('--only=')) ?? '').includes('starve')) {
  hdr('3) Co udela POOLER, kdyz potrebuje NOVY backend a slot neni');
  const r = await starve(DIRECT, POOLED);
  hdr('ZAVER');
  line(r.bad === 0
    ? 'Pooler NEselhal — fronta/recyklace to ustala. Degradace je mekka.'
    : `Pooler selhal u ${r.bad} ze ${r.ok + r.bad} — degradace je TVRDA, rozpocet slotu musi pocitat i s nim.`);
  process.exit(0);
}

// ── 1) kolik backendu stoji N pooled klientu ────────────────────────────────
hdr('1) POOLED: kolik BACKENDU stoji N klientskych spojeni');
line(`vychozi stav: ${JSON.stringify(await backends(DIRECT))}`);
for (const n of [25, 100, 300]) {
  const { clients, err } = await openMany(POOLED, n);
  if (err) { line(`  ${n} pooled klientu: CHYBA ${err.code} ${String(err.message).slice(0, 70)}`); await closeAll(clients); break; }
  // dotaz na kazdem, at PgBouncer opravdu prideli backend
  await Promise.all(clients.map((c) => c.query('SELECT 1').catch(() => undefined)));
  const b = await backends(DIRECT);
  line(`  ${String(clients.length).padStart(3)} pooled klientu -> backendu celkem ${b.vse} (klientskych ${b.klientske})`);
  await closeAll(clients);
  await new Promise((r) => setTimeout(r, 1500));
}

// ── 2) vyhladovi direct pool pooled cestu? ──────────────────────────────────
hdr('2) Kdyz DIRECT vycerpa sloty, funguje jeste POOLED?');
const held = await openMany(DIRECT, 889);
line(`drzim direct spojeni: ${held.clients.length}${held.err ? `  (dal uz ${held.err.code})` : ''}`);
const b2 = await backends(DIRECT).catch((e) => ({ chyba: String(e.message).slice(0, 60) }));
line(`backendu v tu chvili: ${JSON.stringify(b2)}`);

// dalsi DIRECT musi spadnout — self-check, ze je opravdu vycerpano
let directSelfCheck = 'NEDOSLO K VYCERPANI';
try {
  const c = new pg.Client({ connectionString: DIRECT, connectionTimeoutMillis: 10000 });
  await c.connect(); await c.query('SELECT 1'); await c.end();
} catch (e) { directSelfCheck = `${e.code ?? ''} ${String(e.message).slice(0, 70)}`; }
line(`self-check (dalsi DIRECT):  ${directSelfCheck}`);

let pooledVysledek;
try {
  const c = new pg.Client({ connectionString: POOLED, connectionTimeoutMillis: 15000 });
  await c.connect();
  const r = await c.query('SELECT 1 AS ok');
  await c.end();
  pooledVysledek = `PROSLO (${JSON.stringify(r.rows[0])})`;
} catch (e) { pooledVysledek = `SPADLO: ${e.code ?? ''} ${String(e.message).slice(0, 90)}`; }
line(`POOLED pri vycerpanem direct: ${pooledVysledek}`);

await closeAll(held.clients);

hdr('ZAVER');
line(`self-check direct vycerpani: ${directSelfCheck === 'NEDOSLO K VYCERPANI' ? 'SELHAL -> cislo o pooled NEPLATI' : 'OK'}`);
