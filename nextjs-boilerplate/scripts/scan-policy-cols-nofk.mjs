#!/usr/bin/env node
/**
 * scan-policy-cols-nofk.mjs — R-19: sloupce s tenant-jmenem, ktere nemaji FK
 * a pritom se pouzivaji v RLS policy.
 *
 * Proc to vadi: u sloupce s FK se z katalogu overi, kam mirí. Bez FK se to
 * overit NEDA — a §157 uz tri takove nesoulady naslo (jmeno slibovalo neco
 * jineho, nez kam sloupec mirí). Kdyz policy koreluje na takovy sloupec, jsou
 * dve moznosti: mrtva vetev (fail-closed, jako R-18), nebo — kdyz se sloupec
 * porovnava s GUC jineho druhu identity — tichy unik.
 *
 * Seznam se bere ze STRUKTURY (`information_schema` + `pg_policies`), nikdy
 * z dokumentu (§177).
 *
 * SELF-CHECK (§54): na klonu se zalozi dvojice tabulek — jedna se sloupcem
 * BEZ FK v policy (musi se najit) a jedna s FK v policy (nesmi se najit).
 * Kdyz self-check neprojde, skript konci exit 3 a jeho cisla NEPLATI.
 *
 *   node scripts/scan-policy-cols-nofk.mjs <uri>
 */
import pg from 'pg';

const URI = process.argv[2];
if (!URI) { console.error('pouziti: scan-policy-cols-nofk.mjs <uri>'); process.exit(2); }

/** Jmena, ktera SLIBUJI identitu. Zamerne siroke — uzsi by nalezy schovalo. */
const TENANT_RE = '(^|_)(user|promoter|owner|account|buyer|organizer|actor|customer|member|tenant|partner|reseller|agent|seller|holder|recipient|sender|issuer|assignee)_id$';

const SQL_COLS = `
  SELECT c.table_schema AS s, c.table_name AS t, c.column_name AS col
  FROM information_schema.columns c
  JOIN information_schema.tables tb
    ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
   AND tb.table_type = 'BASE TABLE'
  WHERE c.table_schema NOT IN ('pg_catalog','information_schema')
    AND c.column_name ~ $1
`;

const SQL_FK = `
  SELECT tc.table_schema AS s, tc.table_name AS t, kcu.column_name AS col,
         ccu.table_schema AS ref_s, ccu.table_name AS ref_t, ccu.column_name AS ref_col
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
`;

const SQL_POL = `
  SELECT schemaname AS s, tablename AS t, policyname AS p,
         COALESCE(qual,'') || ' ' || COALESCE(with_check,'') AS expr
  FROM pg_policies
`;

const pool = new pg.Pool({ connectionString: URI, max: 3 });

async function nacti() {
  const [cols, fks, pols] = await Promise.all([
    pool.query(SQL_COLS, [TENANT_RE]),
    pool.query(SQL_FK),
    pool.query(SQL_POL),
  ]);
  const fkSet = new Set(fks.rows.map((r) => `${r.s}.${r.t}.${r.col}`));
  const fkMap = new Map(fks.rows.map((r) => [`${r.s}.${r.t}.${r.col}`, `${r.ref_s}.${r.ref_t}.${r.ref_col}`]));
  const polByTable = new Map();
  for (const r of pols.rows) {
    const k = `${r.s}.${r.t}`;
    if (!polByTable.has(k)) polByTable.set(k, []);
    polByTable.get(k).push({ p: r.p, expr: r.expr });
  }
  return { cols: cols.rows, fkSet, fkMap, polByTable };
}

/** Sloupec je „v policy", kdyz se jeho jmeno objevi ve vyrazu policy te tabulky. */
function vPolicy(polByTable, s, t, col) {
  const list = polByTable.get(`${s}.${t}`) ?? [];
  const re = new RegExp(`\\b${col}\\b`);
  return list.filter((x) => re.test(x.expr));
}

// ── SELF-CHECK ──────────────────────────────────────────────────────────────
async function selfCheck() {
  const c = await pool.connect();
  try {
    await c.query('CREATE SCHEMA IF NOT EXISTS r19_selfcheck');
    await c.query('DROP TABLE IF EXISTS r19_selfcheck.s_fk, r19_selfcheck.s_nofk, r19_selfcheck.cil CASCADE');
    await c.query('CREATE TABLE r19_selfcheck.cil (id uuid PRIMARY KEY)');
    // POZITIVNI vzor: user_id BEZ FK, pouzity v policy
    await c.query('CREATE TABLE r19_selfcheck.s_nofk (id uuid PRIMARY KEY, user_id uuid)');
    await c.query('ALTER TABLE r19_selfcheck.s_nofk ENABLE ROW LEVEL SECURITY');
    await c.query("CREATE POLICY sc_nofk ON r19_selfcheck.s_nofk USING (user_id::text = current_setting('app.current_user_id', true))");
    // NEGATIVNI vzor: user_id S FK, taky v policy
    await c.query('CREATE TABLE r19_selfcheck.s_fk (id uuid PRIMARY KEY, user_id uuid REFERENCES r19_selfcheck.cil(id))');
    await c.query('ALTER TABLE r19_selfcheck.s_fk ENABLE ROW LEVEL SECURITY');
    await c.query("CREATE POLICY sc_fk ON r19_selfcheck.s_fk USING (user_id::text = current_setting('app.current_user_id', true))");

    const { cols, fkSet, polByTable } = await nacti();
    const najdi = (t) => cols.some((r) =>
      r.s === 'r19_selfcheck' && r.t === t && r.col === 'user_id' &&
      !fkSet.has(`${r.s}.${r.t}.${r.col}`) && vPolicy(polByTable, r.s, r.t, r.col).length > 0);
    const pos = najdi('s_nofk');
    const neg = najdi('s_fk');
    await c.query('DROP SCHEMA r19_selfcheck CASCADE');
    return { pos, neg };
  } finally { c.release(); }
}

const sc = await selfCheck();
if (!sc.pos || sc.neg) {
  console.error(`SELF-CHECK SELHAL (pozitivni=${sc.pos}, negativni=${sc.neg}) -> cisla NEPLATI.`);
  await pool.end();
  process.exit(3);
}
console.log('SELF-CHECK OK: sloupec bez FK v policy nalezen, sloupec s FK v policy spravne ignorovan.\n');

// ── SKEN ────────────────────────────────────────────────────────────────────
const { cols, fkSet, fkMap, polByTable } = await nacti();

let sFk = 0;
const bezFkVPolicy = [];
for (const r of cols) {
  const key = `${r.s}.${r.t}.${r.col}`;
  if (fkSet.has(key)) { sFk++; continue; }
  const pol = vPolicy(polByTable, r.s, r.t, r.col);
  if (pol.length) bezFkVPolicy.push({ ...r, pol });
}

console.log(`sloupcu s tenant-jmenem celkem : ${cols.length}`);
console.log(`  z toho S FK                  : ${sFk}`);
console.log(`  bez FK                       : ${cols.length - sFk}`);
console.log(`  bez FK A POUZITY V POLICY    : ${bezFkVPolicy.length}   <- R-19\n`);

/**
 * Riziko. Produkcni vetev je PRAZDNA, takze radit podle poctu radku NELZE
 * (§STAV: „produkcni vetev je prazdna"). Proxy misto toho:
 *   +3  policy porovnava sloupec s GUC JINEHO druhu identity (kandidat na UNIK)
 *   +2  sloupec je JEDINA podminka vetve (neni tam admin/service pojistka)
 *   +1  jmeno slibuje uzivatele, ale tabulka je promoter-dimenze (nebo naopak)
 */
/**
 * ⚠️ Policies pouzivaji HELPERY (`app_current_user_id()`), ne
 * `current_setting('app.current_user_id')`. Prvni verze tohohle pravidla
 * hledala jen tvar `app.current_user_id` a byla proto SLEPA — nenasla by ani
 * jeden pripad. Chyti se oba tvary a je na to samostatny self-check nize.
 */
const IDENT = {
  user: /app_current_user_id\s*\(|current_setting\s*\(\s*'app\.current_user_id'/,
  promoter: /app_current_promoter_id\s*\(|current_setting\s*\(\s*'app\.current_promoter_id'/,
};
/**
 * ⚠️ Zarazeni podle JMENA je jen hypoteza a musi se overit kodem.
 * `seller_id` jsem nejdriv dal mezi promoterske a sonda ho vyhodila jako
 * nejrizikovejsi nalez. Overeno v `src/app/api/buyer/resale/list/route.ts`:
 * plni se z `userId` (a routa navic kontroluje `ticket.owner_id !== userId`),
 * takze prodavajici na resale je BEZNY UZIVATEL. Presunuto k user-identite.
 * `agent`/`reseller`/`partner` zustavaji u promotera — NEOVERENO kodem.
 */
const druh = (col) => (/^(promoter|organizer|agent|reseller|partner)_id$/.test(col) ? 'promoter'
  : /^(user|owner|buyer|customer|member|holder|recipient|sender|issuer|assignee|actor|account|seller)_id$/.test(col) ? 'user' : '?');

/**
 * Vrati druh identity, se kterym se `col` ve vyrazu porovnava (nebo null).
 *
 * ⚠️ Prvni verze brala okno regexem s alternaci
 * (`[^\\s(]*\\bcol\\b[^)]{0,80}|[^)]{0,80}\\bcol\\b`) a zabirala jen text PRED
 * sloupcem — pro `(user_id = app_current_promoter_id())` vratila `"(user_id"`,
 * takze helper za rovnitkem nikdy neuvidela. Self-check 2 to odhalil.
 * Ted se bere prosty vyrez +-80 znaku kolem kazdeho vyskytu.
 */
function porovnavaSe(expr, col) {
  const re = new RegExp(`\\b${col}\\b`, 'g');
  let m;
  while ((m = re.exec(expr)) !== null) {
    const okno = expr.slice(Math.max(0, m.index - 80), m.index + col.length + 80);
    if (IDENT.user.test(okno)) return 'user';
    if (IDENT.promoter.test(okno)) return 'promoter';
  }
  return null;
}

function ohodnot(r) {
  let skore = 0;
  const duvody = [];
  const d = druh(r.col);
  for (const p of r.pol) {
    const g = porovnavaSe(p.expr, r.col);
    if (g && d !== '?' && g !== d) {
      skore += 3;
      duvody.push(`${r.col} se porovnava s ${g}-identitou (JINY DRUH) v ${p.p}`);
    }
    if (!/app_is_platform_admin|app_is_service/.test(p.expr)) {
      skore += 2;
      duvody.push(`${p.p}: bez admin/service pojistky (sloupec je jedina podminka)`);
    }
  }
  r.skore = skore;
  r.duvody = [...new Set(duvody)];
}

// SELF-CHECK pravidla „jiny druh identity" — bez nej by nula nic neznamenala.
{
  const pos = { col: 'user_id', pol: [{ p: 'x', expr: '(user_id = public.app_current_promoter_id())' }] };
  const neg = { col: 'user_id', pol: [{ p: 'x', expr: '(user_id = public.app_current_user_id())' }] };
  const posSet = { col: 'promoter_id', pol: [{ p: 'x', expr: "(promoter_id::text = current_setting('app.current_user_id', true))" }] };
  ohodnot(pos); ohodnot(neg); ohodnot(posSet);
  const okPos = pos.duvody.some((d) => d.includes('JINY DRUH'));
  const okNeg = !neg.duvody.some((d) => d.includes('JINY DRUH'));
  const okSet = posSet.duvody.some((d) => d.includes('JINY DRUH'));
  if (!okPos || !okNeg || !okSet) {
    console.error(`SELF-CHECK 2 SELHAL (helper=${okPos}, shoda=${okNeg}, current_setting=${okSet})` +
      ' -> pravidlo „jiny druh identity" NEPLATI.');
    await pool.end();
    process.exit(3);
  }
  console.log('SELF-CHECK 2 OK: zamena druhu identity se najde v obou tvarech (helper i current_setting).\n');
}

for (const r of bezFkVPolicy) ohodnot(r);
bezFkVPolicy.sort((a, b) => b.skore - a.skore || `${a.s}.${a.t}`.localeCompare(`${b.s}.${b.t}`));

console.log('TOP 20 podle rizika (proxy — produkcni vetev je prazdna, radit podle radku nelze):');
for (const r of bezFkVPolicy.slice(0, 20)) {
  console.log(`  [${String(r.skore).padStart(2)}] ${r.s}.${r.t}.${r.col}  policies=${r.pol.map((p) => p.p).join(',')}`);
  for (const d of r.duvody.slice(0, 3)) console.log(`        ${d}`);
}

console.log('\nCELY SEZNAM (schema.tabulka.sloupec | skore):');
for (const r of bezFkVPolicy) console.log(`  ${r.s}.${r.t}.${r.col} | ${r.skore}`);

await pool.end();
