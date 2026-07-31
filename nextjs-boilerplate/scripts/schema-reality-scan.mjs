#!/usr/bin/env node
/**
 * schema-reality-scan.mjs — SÉMANTICKÝ sken kódu proti reálnému schématu.
 *
 * ── Proč existuje, když už máme schema-drift-guard.mjs ────────────────────────
 * Guard je PARSE-ONLY (`PREPARE`). Postgres při parse-analýze ověří, že sloupce
 * a tabulky existují — takže guard vidí 42703/42P01. Je ale STRUKTURÁLNĚ SLEPÝ na
 * všechno, co se vyhodnocuje až při EXEKUCI:
 *   - `NOT NULL` bez defaultu, který INSERT nedodává  → 23502
 *   - `ON CONFLICT` bez odpovídajícího arbiter indexu → 42P10
 *   - `CHECK` constraint porušený literálem v INSERTu → 23514
 * Empiricky (REMEDIATION.md): 9 z 11 rizikových INSERTů neslo skrytý blocker,
 * který guard neviděl. „Guard zelený" o téhle třídě nevypovídá NIC.
 *
 * Tenhle skript proto nepouští SQL vůbec. Vytáhne SQL z kódu, přečte si REÁLNÉ
 * schéma z `information_schema` + `pg_*` a porovná je SÉMANTICKY.
 *
 * ── Co NEDĚLÁ ────────────────────────────────────────────────────────────────
 * Neopravuje. Nemigruje. Nespouští extrahované SQL. Jen čte a reportuje.
 *
 * ── Referenční pravda ────────────────────────────────────────────────────────
 * Ephemeral Neon větev klonovaná z produkční (baseline.sql je STALE, viz
 * REMEDIATION.md §5). Mechanismus je shodný s tests/*.live.test.ts — vytvoř
 * větev, dotáhni connection_uri, na konci SMAŽ ve finally.
 *
 * ── Spuštění ─────────────────────────────────────────────────────────────────
 *   NEON_API_KEY=... node scripts/schema-reality-scan.mjs --ephemeral
 *   NEON_API_KEY=... node scripts/schema-reality-scan.mjs --branch=br-xxx
 *     --md=../FINDINGS_SCHEMA_REALITY.md   zapiš markdown report
 *     --json=out.json                      zapiš strojově čitelný výstup
 *     --migrations                         aplikuj nenasazené migrace 450-452
 *
 * ── ⚠️ FALSE NEGATIVES ───────────────────────────────────────────────────────
 * Skript sám vypisuje sekci FALSE NEGATIVES a je to POVINNÁ součást výstupu.
 * „Sken našel 0" NESMÍ být čteno jako „je to čisté" — přesně tuhle chybu udělal
 * parse-only guard, když ohlásil pokrytí 94,7 % a pak se ukázalo, že celá třída
 * exekučních chyb je mimo jeho dohled.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import pg from 'pg';

const NEON_API = 'https://console.neon.tech/api/v2';
const PROJECT = 'fragrant-wildflower-75132205';
const PROD_BRANCH = 'br-rough-paper-alom0zky';
const DB_NAME = 'neondb';
const ROLE = 'neondb_owner';
const MIGRATIONS_DIR = '../migrations'; // sloučeno do kořenové složky (fc95cb2)
const PENDING_MIGRATIONS = [
  '450_tickets_dedup_unique.sql',
  '451_orders_payment_provider_pos.sql',
  '452_tracking_events_provider_tiktok.sql',
];

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};

const apiKey = process.env.NEON_API_KEY;

// ═══════════════════════════════════════════════════════════════════════════════
// 0) Neon lifecycle (shodné s tests/*.live.test.ts — nevymýšlíme vlastní)
// ═══════════════════════════════════════════════════════════════════════════════
async function neon(path, init = {}) {
  const res = await fetch(NEON_API + path, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Neon API ${res.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

async function createBranch() {
  const j = await neon(`/projects/${PROJECT}/branches`, {
    method: 'POST',
    body: JSON.stringify({
      branch: { parent_id: PROD_BRANCH, name: `reality-scan-${Date.now()}` },
      endpoints: [{ type: 'read_write' }],
    }),
  });
  return j.branch.id;
}

async function connect(branchId) {
  const { uri } = await neon(
    `/projects/${PROJECT}/connection_uri?branch_id=${branchId}` +
      `&role_name=${ROLE}&database_name=${DB_NAME}&pooled=false`,
  );
  let lastErr;
  for (let i = 0; i < 5; i++) {
    const c = new pg.Client({ connectionString: uri, connectionTimeoutMillis: 30_000 });
    try {
      await c.connect();
      return c;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1) EXTRAKCE SQL z kódu (TS AST — stejný přístup jako schema-drift-guard.mjs)
// ═══════════════════════════════════════════════════════════════════════════════
const DML = /\b(INSERT|UPDATE|DELETE|SELECT|WITH)\b/i;

function extract() {
  const files = execSync('git ls-files "src/app/api/**/*.ts" "src/lib/**/*.ts"', {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  const staticQ = [];
  const dynamicQ = [];

  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
    const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
    const visit = (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === 'query' &&
        n.arguments.length
      ) {
        const a = n.arguments[0];
        const line = lineOf(a.getStart(sf));
        if (ts.isNoSubstitutionTemplateLiteral(a) || ts.isStringLiteral(a)) {
          if (DML.test(a.text)) staticQ.push({ file: f, line, sql: a.text });
        } else if (ts.isTemplateExpression(a)) {
          // Dynamicky skládané SQL — parser ho rekonstruovat NEUMÍ.
          // Vede se jmenovitě jako false-negative, ne jako "zkontrolováno".
          const head = a.head.text;
          if (DML.test(head)) dynamicQ.push({ file: f, line, head: head.slice(0, 120) });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { files, staticQ, dynamicQ };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2) INTROSPEKCE reálného schématu
// ═══════════════════════════════════════════════════════════════════════════════
async function introspect(c) {
  const cols = new Map(); // "schema.table" -> Map(col -> meta)
  const colRows = await c.query(`
    SELECT table_schema, table_name, column_name, is_nullable, column_default,
           is_generated, is_identity
      FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog','information_schema','pg_toast')`);
  for (const r of colRows.rows) {
    const key = `${r.table_schema}.${r.table_name}`;
    if (!cols.has(key)) cols.set(key, new Map());
    cols.get(key).set(r.column_name, {
      nullable: r.is_nullable === 'YES',
      hasDefault: r.column_default !== null,
      generated: r.is_generated !== 'NEVER',
      identity: r.is_identity === 'YES',
    });
  }

  // Unique indexy VČETNĚ partial predikátu (information_schema je nezobrazuje —
  // právě na tom se dřív utopil reseller/sale, viz REMEDIATION.md §4a #2).
  // POZOR na `indkey`: je to `int2vector`, ne pole — `unnest()` na něm
  // NEFUNGUJE (ověřeno: vracelo prázdný seznam pro VŠECH 920 indexů a vyrobilo
  // 78 falešných T3). Správně jde přes `attnum = ANY(indkey)`.
  // Množina stačí: ON CONFLICT column-list je v Postgresu order-insensitive.
  const uniq = await c.query(`
    SELECT n.nspname AS schema, t.relname AS "table", i.relname AS index,
           ix.indisprimary AS is_primary,
           ix.indexprs IS NOT NULL AS has_expression,
           ix.indnkeyatts AS key_atts,
           pg_get_expr(ix.indpred, ix.indrelid) AS predicate,
           ARRAY(
             SELECT a.attname::text FROM pg_attribute a
              WHERE a.attrelid = ix.indrelid AND a.attnum = ANY(ix.indkey)
              ORDER BY a.attnum
           ) AS cols
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE ix.indisunique
       AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')`);

  const uniques = uniq.rows.map((u) => {
    const resolved = Array.isArray(u.cols) ? u.cols.filter((x) => x != null) : [];
    return {
      ...u,
      cols: resolved,
      // Výrazový index (`ON (lower(email))`) nebo neúplně rozřešené klíčové
      // sloupce → nebereme ho jako spolehlivý arbiter a řekneme to.
      unreliable: u.has_expression || resolved.length !== u.key_atts,
    };
  });

  const cons = await c.query(`
    SELECT n.nspname AS schema, t.relname AS table, c.conname AS name,
           c.contype, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')`);

  // Triggery — sloupec plněný BEFORE INSERT triggerem NENÍ chybějící.
  const trg = await c.query(`
    SELECT n.nspname AS schema, t.relname AS table, g.tgname AS name,
           p.proname AS func,
           (g.tgtype & 2) <> 0 AS is_before,
           (g.tgtype & 4) <> 0 AS on_insert
      FROM pg_trigger g
      JOIN pg_class t ON t.oid = g.tgrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_proc p ON p.oid = g.tgfoid
     WHERE NOT g.tgisinternal
       AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')`);

  const triggers = new Map(); // table -> [{name, func, before, onInsert}]
  for (const r of trg.rows) {
    const key = `${r.schema}.${r.table}`;
    if (!triggers.has(key)) triggers.set(key, []);
    triggers.get(key).push({
      name: r.tgname ?? r.name,
      func: r.func,
      before: r.is_before,
      onInsert: r.on_insert,
    });
  }

  return { cols, uniques, constraints: cons.rows, triggers };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3) POMOCNÉ PARSERY
// ═══════════════════════════════════════════════════════════════════════════════
/** Odstraní řádkové i blokové SQL komentáře a sjednotí whitespace. */
function clean(sql) {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const norm = (s) =>
  (s ?? '')
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\((.*)\)$/, '$1')
    .trim();

/**
 * Najde `schema.table` v mapě sloupců. Když je název nekvalifikovaný, zkusí
 * najít JEDNOZNAČNOU shodu napříč schématy; při víc kandidátech vrací null
 * a nález se vede jako nerozhodnutý (netipujeme).
 */
function resolveTable(cols, raw) {
  const t = raw.replace(/["`]/g, '').toLowerCase();
  if (t.includes('.')) return cols.has(t) ? t : null;
  const hits = [...cols.keys()].filter((k) => k.endsWith(`.${t}`));
  return hits.length === 1 ? hits[0] : null;
}

/** Rozparsuje INSERT: tabulka, column-list, ON CONFLICT target, VALUES literály. */
function parseInsert(sql) {
  const m = /INSERT\s+INTO\s+([a-z_][\w.]*(?:"[^"]+")?)\s*\(([^)]*)\)/i.exec(sql);
  if (!m) return null;
  const table = m[1];
  const colList = m[2]
    .split(',')
    .map((s) => s.trim().replace(/["`]/g, ''))
    .filter(Boolean);
  if (!colList.length || colList.some((s) => /[\s(]/.test(s))) return null;

  // ON CONFLICT — target může být (cols) [WHERE pred] nebo ON CONSTRAINT name
  let onConflict = null;
  const oc = /ON\s+CONFLICT\s*(?:\(([^)]*)\)\s*(?:WHERE\s+(.+?))?)?\s*(?:ON\s+CONSTRAINT\s+(\w+))?\s*(?:DO\s+(NOTHING|UPDATE))/i.exec(
    sql,
  );
  if (oc) {
    onConflict = {
      cols: oc[1]
        ? oc[1].split(',').map((s) => s.trim().replace(/["`]/g, '').toLowerCase())
        : null,
      predicate: oc[2] ? oc[2].trim() : null,
      constraint: oc[3] ?? null,
      action: (oc[4] ?? '').toUpperCase(),
    };
    // `WHERE` u ON CONFLICT může omylem pohltit i DO UPDATE ... WHERE.
    if (onConflict.predicate) {
      onConflict.predicate = onConflict.predicate.split(/\bDO\s+(?:NOTHING|UPDATE)\b/i)[0].trim();
    }
  }

  // VALUES literály — jen jednoduchý jednorázový tvar, pro T5
  let values = null;
  const vm = /VALUES\s*\(([^;]*?)\)\s*(?:ON\s+CONFLICT|RETURNING|$)/i.exec(sql);
  if (vm) {
    const parts = splitTopLevel(vm[1]);
    if (parts.length === colList.length) values = parts.map((s) => s.trim());
  }

  return { table, colList, onConflict, values, hasSelect: /INSERT[\s\S]*?\bSELECT\b/i.test(sql) };
}

/** Rozdělí seznam na top-level čárkách (respektuje závorky a apostrofy). */
function splitTopLevel(s) {
  const out = [];
  let depth = 0;
  let q = false;
  let cur = '';
  for (const ch of s) {
    if (ch === "'" ) q = !q;
    if (!q && ch === '(') depth++;
    if (!q && ch === ')') depth--;
    if (!q && depth === 0 && ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Mapa alias -> resolved table z FROM / JOIN / UPDATE / INSERT INTO. */
function aliasMap(sql, cols) {
  const map = new Map();
  const re =
    /\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_][\w]*\.[a-z_][\w]*|[a-z_][\w]*)\s*(?:AS\s+)?([a-z_][\w]*)?/gi;
  const KEYWORDS = new Set([
    'set','where','on','using','select','values','returning','left','right','inner',
    'outer','full','cross','join','group','order','limit','offset','and','or','as',
    'do','conflict','update','insert','delete','with','having','union','lateral','when',
  ]);
  let m;
  while ((m = re.exec(sql))) {
    const resolved = resolveTable(cols, m[1]);
    if (!resolved) continue;
    const alias = m[2] && !KEYWORDS.has(m[2].toLowerCase()) ? m[2].toLowerCase() : null;
    if (alias) map.set(alias, resolved);
    // nekvalifikovaný i kvalifikovaný název tabulky jde použít jako prefix taky
    const bare = m[1].split('.').pop().toLowerCase();
    if (!map.has(bare)) map.set(bare, resolved);
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4) ANALYZÁTORY T1–T5
// ═══════════════════════════════════════════════════════════════════════════════
function analyze(q, schema) {
  const { cols, uniques, constraints, triggers } = schema;
  const sql = clean(q.sql);
  const out = [];
  const base = { file: q.file, line: q.line };

  const ins = parseInsert(sql);

  // ─── T1 + T2 + T3 + T5: INSERT cesty ───────────────────────────────────────
  if (ins) {
    const table = resolveTable(cols, ins.table);
    if (!table) {
      out.push({
        ...base,
        cls: 'T0',
        sqlstate: '42P01?',
        table: ins.table,
        column: '',
        confidence: 'medium',
        detail:
          `tabulku "${ins.table}" nelze v reálném schématu najít (ani jednoznačně napříč schématy) ` +
          `→ buď neexistuje (42P01), nebo je název nekvalifikovaný a nejednoznačný`,
      });
    } else {
      const real = cols.get(table);

      // T1 — sloupec v INSERT listu, který neexistuje
      for (const cName of ins.colList) {
        if (!real.has(cName.toLowerCase())) {
          out.push({
            ...base,
            cls: 'T1',
            sqlstate: '42703',
            table,
            column: cName,
            confidence: 'high',
            detail: `INSERT uvádí sloupec "${cName}", který na ${table} NEEXISTUJE`,
          });
        }
      }

      // T2 — NOT NULL bez defaultu, který INSERT nedodává
      if (!ins.hasSelect) {
        const provided = new Set(ins.colList.map((s) => s.toLowerCase()));
        const tTrg = (triggers.get(table) ?? []).filter((t) => t.before && t.onInsert);
        for (const [cName, meta] of real) {
          if (meta.nullable || meta.hasDefault || meta.generated || meta.identity) continue;
          if (provided.has(cName)) continue;
          out.push({
            ...base,
            cls: 'T2',
            sqlstate: '23502',
            table,
            column: cName,
            // BEFORE INSERT trigger MŮŽE sloupec doplnit. Z pg_trigger nejde
            // zjistit KTERÝ sloupec plní → nález se nezahazuje, ale degraduje
            // na low a poznamená se trigger. Netvrdíme, co nevíme.
            confidence: tTrg.length ? 'low' : 'high',
            detail:
              `${table}.${cName} je NOT NULL BEZ defaultu, ale INSERT ho neuvádí` +
              (tTrg.length
                ? ` — ⚠️ na tabulce je BEFORE INSERT trigger (${tTrg
                    .map((t) => `${t.name}→${t.func}()`)
                    .join(', ')}), který ho MŮŽE doplnit; z pg_trigger nejde zjistit který sloupec plní`
                : ''),
          });
        }
      }

      // T3 — ON CONFLICT target bez odpovídajícího arbiter indexu
      if (ins.onConflict && (ins.onConflict.cols || ins.onConflict.constraint)) {
        const oc = ins.onConflict;
        if (oc.constraint) {
          const hit = constraints.find(
            (x) => `${x.schema}.${x.table}` === table && x.name === oc.constraint,
          );
          if (!hit) {
            out.push({
              ...base,
              cls: 'T3',
              sqlstate: '42P10',
              table,
              column: `ON CONSTRAINT ${oc.constraint}`,
              confidence: 'high',
              detail: `constraint "${oc.constraint}" na ${table} neexistuje`,
            });
          }
        } else {
          // Množinové porovnání — ON CONFLICT (a,b) == ON CONFLICT (b,a).
          const setKey = (arr) => [...arr].map((s) => s.toLowerCase()).sort().join(',');
          const want = setKey(oc.cols);
          const onTable = uniques.filter((u) => `${u.schema}.${u.table}` === table);
          const cands = onTable.filter((u) => !u.unreliable && setKey(u.cols) === want);
          if (!cands.length) {
            // Výrazový index by tenhle target teoreticky pokrýt mohl a my to
            // nepoznáme → nález se degraduje, netvrdíme jistotu.
            const risky = onTable.filter((u) => u.unreliable);
            const available = onTable.map(
              (u) =>
                `${u.index}(${u.cols.join(',')})${u.predicate ? ' WHERE ' + u.predicate : ''}` +
                (u.unreliable ? ' [výrazový/nerozřešený]' : ''),
            );
            out.push({
              ...base,
              cls: 'T3',
              sqlstate: '42P10',
              table,
              column: `ON CONFLICT (${oc.cols.join(',')})`,
              confidence: risky.length ? 'low' : 'high',
              detail:
                `na ${table} není žádný unique index/constraint přes (${oc.cols.join(',')}). ` +
                `Dostupné: ${available.length ? available.join(' | ') : '(žádné)'}` +
                (risky.length
                  ? ' — ⚠️ tabulka MÁ výrazový/nerozřešený unique index, který target pokrýt může; sken to nepozná'
                  : ''),
            });
          } else {
            // Partial unique index: predikát MUSÍ sedět, jinak arbiter neplatí.
            const exact = cands.find((u) => norm(u.predicate) === norm(oc.predicate));
            if (!exact) {
              const partial = cands.filter((u) => u.predicate);
              out.push({
                ...base,
                cls: 'T3',
                sqlstate: '42P10',
                table,
                column: `ON CONFLICT (${want})`,
                confidence: 'high',
                detail:
                  `unique index přes (${want}) existuje, ale predikát NESEDÍ. ` +
                  `SQL má: ${oc.predicate ? `WHERE ${oc.predicate}` : '(žádný WHERE)'}; ` +
                  `index má: ${
                    partial.length
                      ? partial.map((u) => `${u.index} WHERE ${u.predicate}`).join(' | ')
                      : '(bez predikátu)'
                  }`,
              });
            }
          }
        }
      }

      // T5 — literál proti CHECK s IN-listem (BEST-EFFORT, viz README v reportu)
      if (ins.values) {
        const checks = constraints.filter(
          (x) => `${x.schema}.${x.table}` === table && x.contype === 'c',
        );
        for (let i = 0; i < ins.colList.length; i++) {
          const cName = ins.colList[i].toLowerCase();
          const lit = /^'([^']*)'$/.exec(ins.values[i]?.trim() ?? '');
          if (!lit) continue; // nejde o literál (param/výraz) → nevyhodnocujeme
          for (const ck of checks) {
            const allowed = extractInList(ck.def, cName);
            if (allowed && !allowed.includes(lit[1])) {
              out.push({
                ...base,
                cls: 'T5',
                sqlstate: '23514',
                table,
                column: cName,
                confidence: 'high',
                detail:
                  `INSERT zapisuje ${cName}='${lit[1]}', ale ${ck.name} povoluje jen ` +
                  `{${allowed.join(', ')}}`,
              });
            }
          }
        }
      }
    }
  }

  // ─── T4: kvalifikované čtení alias.sloupec ─────────────────────────────────
  // ZÁMĚRNĚ jen KVALIFIKOVANÉ odkazy. Nekvalifikované identifikátory by
  // vyžadovaly plný scope resolver a dělaly by hluk s nízkou hodnotou —
  // vedou se jako false negative, ne jako "zkontrolováno".
  const aliases = aliasMap(sql, cols);
  if (aliases.size) {
    const seen = new Set();
    const re = /\b([a-z_][\w]*)\.([a-z_][\w]*)\b/gi;
    let m;
    while ((m = re.exec(sql))) {
      const [, pfx, col] = [m[0], m[1].toLowerCase(), m[2].toLowerCase()];
      // "schema.table" je taky tvar a.b → přeskoč, když je pfx schéma
      if ([...cols.keys()].some((k) => k.startsWith(`${pfx}.`))) continue;
      const table = aliases.get(pfx);
      if (!table) continue;
      const real = cols.get(table);
      if (!real || real.has(col)) continue;
      const k = `${pfx}.${col}`;
      if (seen.has(k)) continue;
      seen.add(k);
      // Konfidence: víc aliasů v dotazu = větší šance, že jsme alias spletli.
      const conf = aliases.size <= 2 ? 'high' : aliases.size <= 4 ? 'medium' : 'low';
      out.push({
        ...base,
        cls: 'T4',
        sqlstate: '42703',
        table,
        column: `${pfx}.${col}`,
        confidence: conf,
        detail:
          `čtení odkazuje na ${pfx}.${col} → ${table}.${col}, který NEEXISTUJE ` +
          `(v dotazu ${aliases.size} rozpoznaných aliasů)`,
      });
    }
  }

  return out;
}

/** Z definice CHECK constraintu vytáhne povolené literály pro daný sloupec. */
function extractInList(def, col) {
  // ARRAY[...] tvar (nejčastější u = ANY (ARRAY[...]))
  const re = new RegExp(`\\b${col}\\b[^)]*?=\\s*ANY\\s*\\(\\s*ARRAY\\[([^\\]]*)\\]`, 'i');
  const m = re.exec(def);
  if (m) {
    const lits = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    return lits.length ? lits : null;
  }
  const re2 = new RegExp(`\\b${col}\\b\\s+IN\\s*\\(([^)]*)\\)`, 'i');
  const m2 = re2.exec(def);
  if (m2) {
    const lits = [...m2[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    return lits.length ? lits : null;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5) FALSE NEGATIVES — povinná sekce
// ═══════════════════════════════════════════════════════════════════════════════
function falseNegatives(ex) {
  const sqlFilesOutsideMigrations = execSync(
    'git ls-files "*.sql" | grep -v "^migrations/" || true',
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean);

  const buildersGrep = safeGrep(
    'git grep -ln -E "(knex|drizzle|prisma|kysely|sequelize|typeorm)" -- src',
  );
  // Heuristika na skládání SQL konkatenací. Držíme ji jednoduchou a bez
  // shell-escape akrobacie — falešně pozitivní řádky jsou tu přijatelné,
  // protože jde o odhad ROZSAHU nedohledu, ne o nález.
  const concatGrep = safeGrep('git grep -ln -E "sql \\+=|query \\+=" -- src');

  return [
    {
      k: 'Dynamicky skládané SQL (template expression)',
      n: ex.dynamicQ.length,
      why:
        'Parser vidí jen `head` před prvním ${…}. Zbytek dotazu — včetně column-listů, ' +
        'ON CONFLICT a WHERE — nezná. Tyhle dotazy NEJSOU zkontrolované. ' +
        'Empiricky sem padl checkout x→x_coord, který guard taky neviděl.',
    },
    {
      k: 'SQL mimo `.query(...)`',
      n: null,
      why:
        'Extraktor hledá výhradně `<něco>.query(<literál>)`. SQL předané přes ' +
        'proměnnou, vrácené z helperu, složené v jiné funkci, nebo poslané jinou ' +
        'metodou než `.query` je mimo dohled.',
    },
    {
      k: 'SQL soubory mimo migrations/',
      n: sqlFilesOutsideMigrations.length,
      why: `Neanalyzováno vůbec: ${sqlFilesOutsideMigrations.join(', ') || '(žádné)'}`,
    },
    {
      k: 'Query buildery / ORM',
      n: buildersGrep.length,
      why: buildersGrep.length
        ? `Soubory s ORM/builder importem: ${buildersGrep.join(', ')}`
        : 'Grep nenašel žádný ORM/builder — projekt jede na raw pg. Nízké riziko.',
    },
    {
      k: 'String concat / .join() skládání',
      n: concatGrep.length,
      why:
        'Heuristika, ne důkaz. Dotaz slepený konkatenací může projít jako "statický" ' +
        'jen částečně, nebo uniknout celý.',
    },
    {
      k: 'T4 nekvalifikované identifikátory',
      n: null,
      why:
        'T4 kontroluje POUZE `alias.sloupec`. Holé `WHERE status = ...` bez prefixu ' +
        'se nekontroluje — vyžadovalo by plný scope resolver. Známá, záměrná mezera.',
    },
    {
      k: 'T5 mimo IN-list / ARRAY CHECK',
      n: null,
      why:
        'T5 pozná jen CHECK ve tvaru `col = ANY(ARRAY[...])` nebo `col IN (...)` ' +
        'a jen když je hodnota v INSERTu literál. Rozsahové CHECKy (`x >= 0`), ' +
        'vícesloupcové a výrazové CHECKy, a hodnoty z parametrů ($1) se NEVYHODNOCUJÍ. ' +
        'Parametrizované hodnoty jsou přitom běžnější — T5 je proto slabý filtr, ' +
        'ne záruka.',
    },
    {
      k: 'Runtime-only jevy',
      n: null,
      why:
        'Sken je statický. Race conditions, poškozený stav z poolu (T-AUDIT-GUC: ' +
        'RESET GUC nechá prázdný string → 23514 nahodile), chování RLS pod jinou rolí ' +
        'než neondb_owner, a chyby závislé na datech nejsou v jeho dosahu.',
    },
    {
      k: 'RLS',
      n: null,
      why:
        'Introspekce běží jako neondb_owner (bypassrls). Dotaz, který projde tady, ' +
        'může pod `tixly_app` vrátit 0 řádků nebo spadnout na policy. Sken o tom nic neříká.',
    },
  ];
}

function safeGrep(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6) MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  if (!apiKey) {
    console.error('NEON_API_KEY není nastavené — odmítám běžet (nemám proti čemu porovnávat).');
    process.exit(2);
  }

  const ex = extract();
  console.log(
    `[scan] souborů: ${ex.files.length} | statických dotazů: ${ex.staticQ.length} | ` +
      `dynamických (NEZKONTROLOVÁNO): ${ex.dynamicQ.length}`,
  );

  let branchId = opt('branch');
  const ephemeral = flag('ephemeral') || !branchId;
  let c;
  let findings = [];
  let schema;

  try {
    if (ephemeral) {
      branchId = await createBranch();
      console.log(`[scan] ephemeral větev: ${branchId} (bude smazána ve finally)`);
      await new Promise((r) => setTimeout(r, 4000));
    }
    c = await connect(branchId);

    if (flag('migrations')) {
      for (const f of PENDING_MIGRATIONS) {
        const p = join(MIGRATIONS_DIR, f);
        if (!existsSync(p)) {
          console.log(`[scan] migrace ${f} NENALEZENA v ${MIGRATIONS_DIR}/ — přeskočeno`);
          continue;
        }
        await c.query(readFileSync(p, 'utf8'));
        console.log(`[scan] aplikována migrace ${f}`);
      }
    }

    schema = await introspect(c);
    console.log(
      `[scan] schéma: ${schema.cols.size} tabulek | ${schema.uniques.length} unique indexů | ` +
        `${schema.constraints.length} constraintů | ${schema.triggers.size} tabulek s triggerem`,
    );

    for (const q of ex.staticQ) findings.push(...analyze(q, schema));
  } finally {
    if (c) await c.end().catch(() => undefined);
    if (ephemeral && branchId) {
      await neon(`/projects/${PROJECT}/branches/${branchId}`, { method: 'DELETE' })
        .then(() => console.log(`[scan] větev ${branchId} smazána`))
        .catch((e) => console.error(`[scan] ⚠️ VĚTEV NESMAZÁNA: ${branchId}`, e));
    }
  }

  // ── výstup ──────────────────────────────────────────────────────────────────
  const ORDER = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'];
  findings.sort(
    (a, b) =>
      ORDER.indexOf(a.cls) - ORDER.indexOf(b.cls) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );

  const byClass = {};
  for (const f of findings) byClass[f.cls] = (byClass[f.cls] ?? 0) + 1;

  console.log('\n═══ NÁLEZY ═══');
  for (const cls of ORDER) {
    const rows = findings.filter((f) => f.cls === cls);
    if (!rows.length) continue;
    console.log(`\n── ${cls} (${rows.length}) ──`);
    for (const f of rows) {
      console.log(
        `  ${f.file}:${f.line} | ${f.table} | ${f.column} | ${f.sqlstate} | ${f.confidence}\n` +
          `      ${f.detail}`,
      );
    }
  }

  const fn = falseNegatives(ex);
  console.log('\n═══ ⚠️ FALSE NEGATIVES (co sken NEVIDÍ) ═══');
  console.log('„Sken našel 0" NEZNAMENÁ „je to čisté". Nezkontrolováno zůstává:');
  for (const x of fn) console.log(`  • ${x.k}${x.n !== null ? ` — ${x.n}` : ''}\n      ${x.why}`);

  console.log(
    `\n═══ SOUHRN ═══\n` +
      ORDER.filter((k) => byClass[k])
        .map((k) => `${k}=${byClass[k]}`)
        .join('  ') +
      `  | celkem=${findings.length}` +
      `\nstatických zkontrolováno=${ex.staticQ.length}  dynamických MIMO DOHLED=${ex.dynamicQ.length}`,
  );

  const jsonOut = opt('json');
  if (jsonOut) {
    writeFileSync(
      jsonOut,
      JSON.stringify(
        {
          scannedFiles: ex.files.length,
          staticQueries: ex.staticQ.length,
          dynamicQueries: ex.dynamicQ,
          byClass,
          findings,
          falseNegatives: fn,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log(`\n[scan] JSON: ${jsonOut}`);
  }

  // Skript je REPORTOVACÍ — exit 0 i s nálezy. Nemá shazovat CI, dokud se
  // nerozhodne, co z nálezů je dluh a co regrese.
  process.exit(0);
}

main().catch((e) => {
  console.error('[scan] CHYBA:', e);
  process.exit(1);
});
