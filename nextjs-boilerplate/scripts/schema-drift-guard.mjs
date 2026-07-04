/**
 * CI schema-drift guard (HANDOFF sekce 5 bod 2 - "kontrakt-test kazdy SQL vs schema").
 *
 * Staticky projede KAZDY staticky DML dotaz v src/app/api + src/lib a necha ho
 * PARSNOUT zivym Postgresem pres PREPARE (parse-only, zadna exekuce). Chybejici
 * sloupec/tabulka -> 42703/42P01 -> DRIFT. Tim drift spadne v CI, ne az v produkci
 * na runtime 42703.
 *
 * Varianta A: korektnost stoji na parseru Postgresu, ne na reimplementaci SQL scope
 * resolveru -> ~nula guard-side bugu.
 *
 * Zdroj pravdy o schematu = CERSTVA prod-clone Neon vetev (schema-only staci).
 *
 * REZIMY:
 *   --ephemeral             vytvori docasnou vetev z produkce, po behu ji smaze (pro CI).
 *                           jinak cte GUARD_BRANCH_ID z env (lokalni dev).
 *   --baseline <path>       NEBLOKUJICI: pada jen na NOVEM driftu nad baseline (regrese-ochrana).
 *                           existujici dluh (grandfathered) neshazuje CI. Kdyz current < baseline,
 *                           upozorni, ze lze baseline utahnout. Na prazdny baseline -> blocking.
 *   --write-baseline <path> zapise baseline snapshot soucasneho driftu a skonci 0.
 *   --self-test             navic overi pravdivostni tabulku + ordering 42P18-za-column-resolution.
 *   (bez baseline)          STRICT: pada na JAKEMKOLI driftu.
 *
 * Dynamicke SQL (`${...}`) NELZE staticky rekonstruovat -> guard je NEkontroluje,
 * ale VZDY vypise jmenovite (soubor:radek) jako viditelnou, sledovatelnou mezeru.
 *
 * Exit: 0 = OK; 1 = (novy) drift; 2 = chyba guardu; 3 = self-test neprosel.
 */
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import pg from 'pg';

const KEY = process.env.NEON_API_KEY;
const PROJECT = process.env.GUARD_PROJECT_ID || 'fragrant-wildflower-75132205';
const PROD_BRANCH = process.env.GUARD_PROD_BRANCH || 'br-rough-paper-alom0zky';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const EPHEMERAL = has('--ephemeral');
const SELF_TEST = has('--self-test');
const BASELINE_PATH = val('--baseline');
const WRITE_BASELINE_PATH = val('--write-baseline');

if (!KEY) { console.error('need NEON_API_KEY'); process.exit(2); }

const DML = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i;
const DRIFT_CODES = new Set(['42703', '42P01', '42P17', '42704']); // undefined column/table/object
// 42P18 = indeterminate param type -> parse-analyza sloupcu PROBEHLA (jinak 42703 driv) -> PASS
// 42601 syntax / 42883 fn / 42803 GROUP BY / 42P08 param typ -> INCONCLUSIVE (log, ne drift)

// ---------- Neon API ----------
async function api(path, method = 'GET', body) {
  const r = await fetch(`https://console.neon.tech/api/v2/${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Neon API ${r.status}: ${JSON.stringify(j)}`);
  return j;
}
async function createBranch() {
  const j = await api(`projects/${PROJECT}/branches`, 'POST', {
    branch: { parent_id: PROD_BRANCH, name: `schema-drift-ci-${Date.now()}` },
    endpoints: [{ type: 'read_write' }],
  });
  return { id: j.branch.id };
}
async function deleteBranch(id) { await api(`projects/${PROJECT}/branches/${id}`, 'DELETE', undefined); }
async function connUri(branchId) {
  const j = await api(`projects/${PROJECT}/connection_uri?branch_id=${branchId}&role_name=neondb_owner&database_name=neondb&pooled=false`);
  return j.uri;
}

// ---------- 1) EXTRACTION (TS AST) ----------
function extract() {
  const files = execSync('git ls-files "src/app/api/**/*.ts" "src/lib/**/*.ts"', { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
  const staticQ = [], dynamicQ = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
    const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
    const visit = (n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
          && n.expression.name.text === 'query' && n.arguments.length) {
        const a = n.arguments[0];
        const line = lineOf(a.getStart(sf));
        if (ts.isNoSubstitutionTemplateLiteral(a) || ts.isStringLiteral(a)) {
          if (DML.test(a.text)) staticQ.push({ file: f, line, sql: a.text });
        } else if (ts.isTemplateExpression(a)) {
          if (DML.test(a.head.text)) dynamicQ.push({ file: f, line });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { staticQ, dynamicQ };
}

// ---------- 2) CHECK (PREPARE parse-only) ----------
async function openClient(branchId) {
  const uri = await connUri(branchId);
  let c, lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {   // Neon compute cold-start retry
    c = new pg.Client({ connectionString: uri, connectionTimeoutMillis: 30000 });
    try { await c.connect(); break; } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 3000)); c = null; }
  }
  if (!c) throw lastErr;
  const sch = await c.query(`SELECT schema_name FROM information_schema.schemata
    WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast')
      AND schema_name NOT LIKE 'pg_temp%' AND schema_name NOT LIKE 'pg_toast%'`);
  await c.query(`SET search_path TO ${sch.rows.map(x => `"${x.schema_name}"`).join(', ')}`);
  return { c, schemaCount: sch.rows.length };
}

async function checkOne(c, sql, i) {
  try {
    await c.query(`PREPARE _g_${i} AS ${sql}`);
    return { status: 'ok' };
  } catch (e) {
    const code = e.code || '?';
    if (DRIFT_CODES.has(code)) return { status: 'drift', code, msg: e.message };
    if (code === '42P18') return { status: 'ok' };                     // param type - columns OK
    return { status: 'inconclusive', code, msg: e.message };
  }
  // bez expliticniho BEGIN bezi kazdy PREPARE v autocommitu; pri chybe se sam zahodi.
  // Unikatni jmeno _g_${i} -> zadna kolize, zadny dealloc.
}

// ---------- baseline (grupovani podle soubor+kod+zprava; radky NEjsou v klici) ----------
const firstLine = (m) => String(m).split('\n')[0].trim();
const SEP = '\u0000'; // separator (NUL) se nikdy neobjevi v ceste ani zprave
function groupDrift(drift) {
  const m = new Map(); // key -> {file, code, msg, count}
  for (const d of drift) {
    const msg = firstLine(d.msg);
    const k = d.file + SEP + d.code + SEP + msg;
    const e = m.get(k) || { file: d.file, code: d.code, msg, count: 0 };
    e.count++; m.set(k, e);
  }
  return m;
}

// ---------- MAIN ----------
(async () => {
  console.log(`# schema-drift-guard - Varianta A (PREPARE parse-only)`);
  const { staticQ, dynamicQ } = extract();

  // Vytvoreni vetve je UVNITR try, aby ji finally VZDY smazal — i kdyz guard najde
  // drift (exit 1) NEBO cokoli mezi create a pripojenim hodi. Zadna prod-clone vetev
  // se tak nehromadi po cervenych/spadlych bezech.
  let branchId, ephemeralCreated = false, exitCode = 0, client;
  try {
    if (EPHEMERAL) {
      branchId = (await createBranch()).id; ephemeralCreated = true;
      console.log(`# ephemeral prod-clone vetev vytvorena: ${branchId}`);
    } else {
      branchId = process.env.GUARD_BRANCH_ID;
      if (!branchId) throw new Error('bez --ephemeral je potreba GUARD_BRANCH_ID');
      console.log(`# zdroj pravdy: existujici vetev ${branchId}`);
    }
    const { c, schemaCount } = await openClient(branchId);
    client = c;
    console.log(`# schemata v search_path: ${schemaCount}`);
    const cov = (100 * staticQ.length / (staticQ.length + dynamicQ.length)).toFixed(1);
    console.log(`# statickych DML: ${staticQ.length} | dynamickych (nekontrolovano): ${dynamicQ.length} | pokryti: ${cov} %\n`);

    if (SELF_TEST) {
      const probe = await checkOne(c, `SELECT bogus_col_xyz FROM orders.orders WHERE id = $1`, 'probe');
      const ok = probe.status === 'drift' && probe.code === '42703';
      console.log(`=== SELF-TEST ordering: neexist. sloupec + untyped param -> ${probe.code || probe.status} ${ok ? 'OK (42P18=PASS pravidlo DRZI)' : 'FAIL'}\n`);
    }

    const drift = [], inconclusive = [];
    for (let i = 0; i < staticQ.length; i++) {
      const r = await checkOne(c, staticQ[i].sql, i);
      if (r.status === 'drift') drift.push({ ...staticQ[i], ...r });
      else if (r.status === 'inconclusive') inconclusive.push({ ...staticQ[i], ...r });
    }

    // Dynamicke SQL - vzdy jmenovite (viditelna mezera)
    console.log(`=== DYNAMICKE SQL - NEKONTROLOVANO (${dynamicQ.length}) - sledovatelna mezera ===`);
    for (const d of dynamicQ) console.log(`  . ${d.file}:${d.line}`);
    console.log('');

    if (inconclusive.length) {
      console.log(`=== INCONCLUSIVE (${inconclusive.length}) - ne-drift (multi-stmt/fn/group-by/param) ===`);
      for (const q of inconclusive) console.log(`  . ${q.file}:${q.line}  [${q.code}] ${firstLine(q.msg).slice(0, 90)}`);
      console.log('');
    }

    console.log(`=== DRIFT nalezen (${drift.length}) ===`);
    for (const q of drift) console.log(`  x ${q.file}:${q.line}  [${q.code}] ${firstLine(q.msg).slice(0, 100)}`);
    if (!drift.length) console.log('  (zadny drift ve statickych dotazech)');
    console.log('');

    // --- WRITE BASELINE ---
    if (WRITE_BASELINE_PATH) {
      const groups = groupDrift(drift);
      const entries = [...groups.values()].sort((a, b) => (a.file + a.msg).localeCompare(b.file + b.msg));
      const baseline = {
        note: 'Snapshot known-drift mist. CI (--baseline) pada jen na NOVEM driftu nad tento snapshot. Utahovat, jak fixy ubyvaji; na 0 -> blocking.',
        generatedAt: new Date().toISOString(),
        totalDrift: drift.length,
        distinctKeys: entries.length,
        entries,
      };
      writeFileSync(WRITE_BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
      console.log(`baseline zapsan: ${WRITE_BASELINE_PATH} (${drift.length} mist / ${entries.length} klicu)`);
    }

    // --- SELF-TEST truth table ---
    let selfFail = false;
    if (SELF_TEST) {
      const GREEN = ['src/app/api/buyer/orders/[orderId]/cancel/route.ts', 'src/app/api/admin/scanner/cross-pass/route.ts', 'src/app/api/admin/events/[id]/guestlist/checkin/route.ts'];
      const RED = ['src/app/api/checkout/route.ts', 'src/app/api/my/tickets/[ticketId]/transfer/route.ts', 'src/app/api/tickets/transfer/[token]/route.ts'];
      const dset = new Set(drift.map(d => d.file));
      console.log('=== SELF-TEST pravdivostni tabulka ===');
      for (const f of GREEN) { const clean = !dset.has(f); if (!clean) selfFail = true; console.log(`  GREEN ${clean ? 'OK' : 'FAIL'} ${f}`); }
      for (const f of RED) { const red = dset.has(f); if (!red) selfFail = true; console.log(`  RED   ${red ? 'OK' : 'FAIL'} ${f}`); }
      console.log(`  -> SELF-TEST: ${selfFail ? 'NEPROSEL' : 'PROSEL'}\n`);
    }

    // --- BASELINE COMPARE (non-blocking) ---
    if (BASELINE_PATH) {
      const base = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
      const baseCounts = new Map((base.entries || []).map(e => [e.file + SEP + e.code + SEP + e.msg, e.count]));
      const curGroups = groupDrift(drift);
      const newDrift = [];
      for (const [k, e] of curGroups) { const b = baseCounts.get(k) || 0; if (e.count > b) newDrift.push({ ...e, base: b }); }
      const reducedTotal = base.totalDrift - drift.length;
      console.log('=== BASELINE compare (neblokujici) ===');
      console.log(`  baseline: ${base.totalDrift} mist / ${(base.entries || []).length} klicu (${base.generatedAt})`);
      console.log(`  current:  ${drift.length} mist / ${curGroups.size} klicu`);
      if (newDrift.length) {
        console.log(`  NOVY drift nad baseline (${newDrift.length}) - CI FAIL:`);
        for (const d of newDrift) console.log(`     x ${d.file} [${d.code}] ${d.msg}  (base ${d.base} -> nyni ${d.count})`);
        exitCode = 1;
      } else {
        console.log(`  OK - zadny novy drift nad baseline`);
        if (reducedTotal > 0) console.log(`  dluh klesl o ${reducedTotal} -> baseline lze UTAHNOUT (--write-baseline).`);
        if (drift.length === 0) console.log(`  drift = 0 -> prepnout na STRICT (blocking) rezim.`);
      }
      console.log('');
    } else if (!WRITE_BASELINE_PATH) {
      if (drift.length) { exitCode = 1; console.log('STRICT rezim: drift pritomen -> CI FAIL.'); }
    }

    if (SELF_TEST && selfFail) exitCode = 3;
    console.log(`# SUMMARY: drift=${drift.length} inconclusive=${inconclusive.length} dynamic-uncovered=${dynamicQ.length} coverage=${cov}%`);
  } finally {
    if (client) await client.end().catch(() => {});
    if (ephemeralCreated) { try { await deleteBranch(branchId); console.log(`# ephemeral vetev smazana: ${branchId}`); } catch (e) { console.error(`# VAROVANI: nepodarilo se smazat vetev ${branchId}: ${e.message}`); } }
  }
  process.exit(exitCode);
})().catch(e => { console.error('GUARD FATAL', e); process.exit(2); });
