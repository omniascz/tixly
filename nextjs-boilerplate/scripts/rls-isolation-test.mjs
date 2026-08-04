#!/usr/bin/env node
/**
 * rls-isolation-test.mjs — empirický test tenant isolace pro RLS VZORCE.
 *
 * ── Otázka ───────────────────────────────────────────────────────────────────
 * Sčítání (rls-policy-census.mjs) říká, KOLIK vzorců existuje. Tenhle skript
 * říká, které z nich něco DĚLAJÍ: dva tenanti, data obou, připojení jako
 * `tixly_app` s GUC tenanta A → uvidím / změním řádek tenanta B?
 *
 * ── Jak se seeduje ───────────────────────────────────────────────────────────
 * Řádky se zakládají jako owner s `DISABLE TRIGGER ALL` na cílové tabulce.
 * Cílem NENÍ referenční integrita, ale vyhodnocení predikátu — a ten čte
 * `promoter_id` / `user_id` / `event_id` z řádku, ne z cizí tabulky (u vzorců
 * s poddotazem se proto seeduje i řetěz promoter→event).
 * NOT NULL sloupce bez defaultu se dopl­ňují podle typu.
 *
 * ── Verdikt ──────────────────────────────────────────────────────────────────
 *   ÚČINNÝ  — A nevidí a nezmění řádek B
 *   DĚRAVÝ  — A vidí nebo změní řádek B
 *   NEVÍM   — nepodařilo se založit data (typicky složitý NOT NULL řetěz)
 *
 *   NEON_API_KEY=... node scripts/rls-isolation-test.mjs clone.json [--json=out]
 */
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const clone = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const jsonOut = (process.argv.find((a) => a.startsWith('--json=')) || '').split('=')[1];

const A = { promoter: randomUUID(), user: randomUUID(), event: randomUUID() };
const B = { promoter: randomUUID(), user: randomUUID(), event: randomUUID() };

const owner = new pg.Client({ connectionString: clone.ownerUri });
await owner.connect();

/** Hodnota pro NOT NULL sloupec bez defaultu, podle typu. */
function dummy(type, col) {
  if (/uuid/.test(type)) return randomUUID();
  if (/int|numeric|decimal|real|double/.test(type)) return 1;
  if (/bool/.test(type)) return false;
  if (/timestamp|date|time/.test(type)) return new Date('2026-01-01T00:00:00Z');
  if (/json/.test(type)) return '{}';
  if (/\[\]/.test(type)) return '{}';
  if (/bytea/.test(type)) return Buffer.from('x');
  // `character(2)` apod. — bez respektování délky padá seed na 22001 a strhne
  // s sebou celý FK řetěz (nejčastěji catalog.events → desítky dalších tabulek).
  const len = Number(type.match(/\((\d+)\)/)?.[1] ?? 0);
  const s = `rls_${col}_${randomUUID().slice(0, 8)}`;
  return len > 0 ? s.slice(0, len) : s;
}

/** FK: sloupec → cílová tabulka. Bez toho seed padá na 23503. */
async function fks(schema, table) {
  const rows = (
    await owner.query(
      `SELECT a.attname col, tn.nspname rs, tc.relname rt, ta.attname rcol
       FROM pg_constraint k
       JOIN pg_class c ON c.oid=k.conrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       JOIN pg_class tc ON tc.oid=k.confrelid
       JOIN pg_namespace tn ON tn.oid=tc.relnamespace
       JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=k.conkey[1]
       JOIN pg_attribute ta ON ta.attrelid=k.confrelid AND ta.attnum=k.confkey[1]
       WHERE k.contype='f' AND n.nspname=$1 AND c.relname=$2
         AND array_length(k.conkey,1)=1`,
      [schema, table],
    )
  ).rows;
  return Object.fromEntries(rows.map((r) => [r.col, r]));
}

/** CHECK typu `col = ANY (ARRAY['a','b'])` nebo `col IN ('a','b')` → povolená hodnota. */
async function checkVals(schema, table) {
  const defs = (
    await owner.query(
      `SELECT pg_get_constraintdef(k.oid) d FROM pg_constraint k
       JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE k.contype='c' AND n.nspname=$1 AND c.relname=$2`,
      [schema, table],
    )
  ).rows.map((r) => r.d);
  const out = {};
  for (const d of defs) {
    // `::text` za názvem sloupce je nepovinné — `kind = ANY (ARRAY[…])` je
    // stejně častý tvar jako `(kind)::text = ANY (…)`.
    const m =
      d.match(/\(?\(?([a-z_0-9]+)\)?(?:::[a-z ]+)?\s*=\s*ANY\s*\(\(?ARRAY\[([^\]]+)\]/i) ||
      d.match(/\(?([a-z_0-9]+)\)?\s+IN\s+\(([^)]+)\)/i);
    if (m) {
      const first = m[2].split(',')[0].trim().match(/'([^']*)'/);
      if (first) out[m[1]] = first[1];
    }
  }
  return out;
}

const parentCache = new Map();

async function cols(schema, table) {
  return (
    await owner.query(
      `SELECT a.attname col, format_type(a.atttypid,a.atttypmod) typ, a.attnotnull nn,
              pg_get_expr(d.adbin,d.adrelid) IS NOT NULL has_def
       FROM pg_attribute a
       JOIN pg_class c ON c.oid=a.attrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
       WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped
       ORDER BY a.attnum`,
      [schema, table],
    )
  ).rows;
}

/**
 * Vloží řádek do libovolné tabulky. FK se rekurzivně dopl­ňují skutečnými
 * rodiči (jinak 23503), CHECK sloupce dostanou povolenou hodnotu (jinak 23514).
 */
async function insertRow(schema, table, force = {}, depth = 0) {
  if (depth > 4) throw new Error('příliš hluboký FK řetěz');
  const [cs, fk, chk] = await Promise.all([
    cols(schema, table),
    fks(schema, table),
    checkVals(schema, table),
  ]);
  const vals = {};
  for (const c of cs) {
    if (force[c.col] !== undefined) {
      vals[c.col] = force[c.col];
      continue;
    }
    if (c.col === 'id' && /uuid/.test(c.typ) && !c.has_def) vals.id = randomUUID();
    if (!c.nn || c.has_def) continue;
    if (fk[c.col]) {
      const p = fk[c.col];
      const key = `${p.rs}.${p.rt}`;
      if (!parentCache.has(key)) parentCache.set(key, await insertRow(p.rs, p.rt, {}, depth + 1));
      vals[c.col] = parentCache.get(key)[p.rcol];
    } else if (chk[c.col] !== undefined) vals[c.col] = chk[c.col];
    else vals[c.col] = dummy(c.typ, c.col);
  }
  // FK sloupce, které jsme vynutili (tenant), musí mít existujícího rodiče —
  // o to se stará seedChain(); tady je bereme jak jsou.
  const keys = Object.keys(vals);
  // Tabulka, kde má každý sloupec default (typicky singleton nastavení).
  const r = keys.length
    ? await owner.query(
        `INSERT INTO "${schema}"."${table}" (${keys.map((k) => `"${k}"`).join(',')})
     VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})
     ON CONFLICT DO NOTHING RETURNING *`,
        keys.map((k) => vals[k]),
      )
    : await owner.query(
        `INSERT INTO "${schema}"."${table}" DEFAULT VALUES ON CONFLICT DO NOTHING RETURNING *`,
      );
  return r.rows[0] ?? vals;
}

/** Sloupce primárního klíče — `id` neexistuje všude (jinak 42703). */
async function pkCols(schema, table) {
  return (
    await owner.query(
      `SELECT a.attname c FROM pg_constraint k
       JOIN pg_class cl ON cl.oid=k.conrelid
       JOIN pg_namespace n ON n.oid=cl.relnamespace
       JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=ANY(k.conkey)
       WHERE k.contype='p' AND n.nspname=$1 AND cl.relname=$2`,
      [schema, table],
    )
  ).rows.map((r) => r.c);
}

/** Založí jeden řádek pro daného tenanta; vrátí jeho id nebo vyhodí. */
async function seedRow(schema, table, tenant) {
  const cs = await cols(schema, table);
  const has = (n) => cs.some((c) => c.col === n);
  const force = {};
  if (has('promoter_id')) force.promoter_id = tenant.promoter;
  if (has('user_id')) force.user_id = tenant.user;
  if (has('owner_user_id')) force.owner_user_id = tenant.user;
  if (has('event_id')) force.event_id = tenant.event;
  return { row: await insertRow(schema, table, force) };
}

// ── řetěz promoter → event (pro vzorce s poddotazem) ────────────────────────
async function seedChain() {
  for (const t of [A, B]) {
    for (const [sch, tab, force] of [
      ['platform', 'promoters', { id: t.promoter }],
      ['identity', 'users', { id: t.user }],
      ['catalog', 'events', { id: t.event, promoter_id: t.promoter }],
    ]) {
      await insertRow(sch, tab, force).catch((e) =>
        console.log(`   [chain] ${sch}.${tab}: ${e.code || ''} ${(e.message || '').slice(0, 90)}`),
      );
    }
  }
}

// ── cílové tabulky ───────────────────────────────────────────────────────────
const targets = JSON.parse(readFileSync(process.argv[3], 'utf8'));

await owner.query(`SET session_replication_role = 'replica'`).catch(() => {});
await seedChain();

// Tabulky řetězu jsou taky cíle. Musí přijít PRVNÍ — než na ně navěsí řádky
// FK rekurze — a po testu se obnoví, jinak se pod nimi rozpadnou všechny další.
const CHAIN = { 'platform.promoters': 'promoter', 'identity.users': 'user', 'catalog.events': 'event' };
targets.sort((a, b) => (CHAIN[b.table] ? 1 : 0) - (CHAIN[a.table] ? 1 : 0));

const results = [];
for (const tgt of targets) {
  const [schema, table] = tgt.table.split('.');
  const r = { ...tgt, verdict: 'NEVÍM', detail: '' };
  const chainKind = CHAIN[tgt.table];
  try {
    await owner.query(`DELETE FROM "${schema}"."${table}"`).catch(() => {});
    parentCache.delete(tgt.table);
    let bRow;
    if (chainKind) {
      // zachovat identitu tenanta, jinak přestane platit GUC kontext
      await insertRow(schema, table, {
        id: A[chainKind],
        ...(chainKind === 'event' ? { promoter_id: A.promoter } : {}),
      });
      await insertRow(schema, table, {
        id: B[chainKind],
        ...(chainKind === 'event' ? { promoter_id: B.promoter } : {}),
      });
      bRow = { row: { [chainKind === 'event' ? 'id' : 'id']: B[chainKind] } };
    } else {
      await seedRow(schema, table, A);
      bRow = await seedRow(schema, table, B);
    }
    const total = (await owner.query(`SELECT count(*)::int n FROM "${schema}"."${table}"`)).rows[0].n;
    if (total < 2) throw new Error(`seed dal jen ${total} řádků`);

    // ── jako tixly_app s GUC tenanta A ─────────────────────────────────────
    const app = new pg.Client({ connectionString: clone.appUri });
    await app.connect();
    await app.query(`SET app.current_promoter_id = '${A.promoter}'`);
    await app.query(`SET app.current_user_id = '${A.user}'`);
    await app.query(`SET app.role = 'promoter'`);
    await app.query(`SET app.is_platform_admin = 'false'`);

    let seen = null;
    let selErr = null;
    try {
      seen = (await app.query(`SELECT count(*)::int n FROM "${schema}"."${table}"`)).rows[0].n;
    } catch (e) {
      selErr = `${e.code} ${e.message.slice(0, 80)}`;
    }

    let upd = null;
    let updErr = null;
    const pks = await pkCols(schema, table);
    if (pks.length && bRow.row && pks.every((k) => bRow.row[k] !== undefined)) {
      try {
        const where = pks.map((k, i) => `"${k}"=$${i + 1}`).join(' AND ');
        const u = await app.query(
          `UPDATE "${schema}"."${table}" SET "${pks[0]}"="${pks[0]}" WHERE ${where}`,
          pks.map((k) => bRow.row[k]),
        );
        upd = u.rowCount;
      } catch (e) {
        updErr = `${e.code} ${e.message.slice(0, 80)}`;
      }
    }
    await app.end();

    if (selErr && /22P02/.test(selErr)) {
      r.verdict = 'CHYBA';
      r.detail = `SELECT havaruje: ${selErr}`;
    } else if (selErr) {
      r.verdict = 'ÚČINNÝ';
      r.detail = `SELECT odmítnut: ${selErr}`;
    } else if (seen >= 2 || (upd ?? 0) > 0) {
      r.verdict = 'DĚRAVÝ';
      r.detail = `vidí ${seen}/2 řádků (2 = i cizí tenant); UPDATE cizího řádku ovlivnil ${upd ?? 0}`;
    } else {
      r.verdict = 'ÚČINNÝ';
      r.detail = `vidí ${seen}/2 řádků; UPDATE cizího řádku ovlivnil ${upd ?? 0}${updErr ? ` (${updErr})` : ''}`;
    }
  } catch (e) {
    r.detail = `seed selhal: ${e.code || ''} ${(e.message || '').slice(0, 110)}`;
  }
  results.push(r);
  const icon = { ÚČINNÝ: '🟢', DĚRAVÝ: '🔴', CHYBA: '💥', NEVÍM: '⚪' }[r.verdict];
  console.log(`${icon} ${r.verdict.padEnd(7)} ${tgt.table.padEnd(42)} ${r.detail}`);
}
await owner.query(`SET session_replication_role = 'origin'`).catch(() => {});
await owner.end();

const tally = results.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] || 0) + 1), a), {});
console.log(`\n═══ VERDIKT ═══ ${JSON.stringify(tally)}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
