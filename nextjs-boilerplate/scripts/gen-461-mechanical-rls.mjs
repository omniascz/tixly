#!/usr/bin/env node
/**
 * gen-461-mechanical-rls.mjs — vygeneruje migraci 461 z KATALOGU, ne z ruky.
 *
 * ── Proč generovat ───────────────────────────────────────────────────────────
 * 19 tabulek × týž tvar policy. Ručně psaná migrace by se lišila překlepem
 * a překlep v RLS se pozná až tím, že aplikace přestane vidět data — nebo je
 * začne vidět všem. Generátor navíc KAŽDOU tabulku ověří proti katalogu:
 *
 *   1. tabulka existuje
 *   2. deklarovaný sloupec na ní existuje
 *   3. je typu uuid
 *   4. je NOT NULL   ← bez toho by řádek s NULL neprošel žádnou větví
 *   5. tabulka dnes NEMÁ policy  ← jinak bychom přepisovali cizí rozhodnutí
 *
 * Když kterákoli podmínka selže, generátor SKONČÍ a nic nenapíše. To je
 * self-check z §54: nula z nástroje nic neznamená, dokud se neukáže, že
 * nástroj tu třídu nálezu najít umí. Ověřeno vloženým špatným vstupem
 * (viz --selfcheck).
 *
 *   node scripts/gen-461-mechanical-rls.mjs --url=<conn> [--selfcheck] [--out=<p>]
 */
import pg from 'pg';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const h = argv.find((a) => a.startsWith(`--${n}=`));
  return h ? h.slice(n.length + 3) : d;
};
const flag = (n) => argv.includes(`--${n}`);

// ── Deklarace: 16 promotérských + 3 uživatelské = 19 (FINDINGS §100/§106) ────
// ⚠️ §100 tvrdil 20. Bylo to o jednu vedle: `marketing.fan_bonus_issued` má
// `user_id` NULLABLE, takže patří mezi NEJASNÉ, ne mezi mechanické. Odhalil to
// tenhle generátor při ověřování proti katalogu, ne kontrola dokumentu.
// Sloupec MUSÍ být na řádku přímo. Několik z nich má i `event_id`, ale ten je
// redundantní — přes akci se JOINovat nemusí, a proto se těchhle 19 netýká
// §53 (drahá korelace ve vnořeném RLS).
const TABLES = [
  ['analytics.yield_rules', 'promoter_id'],
  ['brands.event_partnerships', 'promoter_id'],
  ['catalog.event_reschedules', 'promoter_id'],
  ['catalog.productions', 'promoter_id'],
  ['catalog.season_pass_products', 'promoter_id'],
  ['communications.broadcasts', 'promoter_id'],
  ['communications.emergency_announcements', 'promoter_id'],
  ['orders.guestlist_entries', 'promoter_id'],
  ['orders.lottery_campaigns', 'promoter_id'],
  ['orders.phone_orders', 'promoter_id'],
  ['orders.press_accreditations', 'promoter_id'],
  ['orders.school_bookings', 'promoter_id'],
  ['platform.import_jobs', 'promoter_id'],
  ['platform.promoter_contacts', 'promoter_id'],
  ['platform.promoter_onboarding', 'promoter_id'],
  ['pricing.dynamic_pricing_rules', 'promoter_id'],
  ['identity.fan_profiles', 'user_id'],
  ['notifications.push_sent_log', 'user_id'],
  ['platform.agent_mandates', 'user_id'],
];

// Špatný vstup pro self-check: tabulka existuje, ale `promoter_id` na ní není.
const BAD = ['identity.users', 'promoter_id'];

const HELPER = { promoter_id: 'app_current_promoter_id', user_id: 'app_current_user_id' };

async function verify(uri, list) {
  const c = new pg.Client({ connectionString: uri });
  await c.connect();
  const problems = [];
  const ok = [];
  for (const [tbl, col] of list) {
    const [schema, name] = tbl.split('.');
    const r = await c.query(
      `SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS typ, a.attnotnull,
              (SELECT count(*)::int FROM pg_policies p
                WHERE p.schemaname=$1 AND p.tablename=$2) AS npol
         FROM pg_class cl
         JOIN pg_namespace n ON n.oid=cl.relnamespace AND n.nspname=$1
         LEFT JOIN pg_attribute a
                ON a.attrelid=cl.oid AND a.attname=$3 AND a.attnum>0 AND NOT a.attisdropped
        WHERE cl.relname=$2 AND cl.relkind='r'`,
      [schema, name, col],
    );
    if (r.rowCount === 0) { problems.push(`${tbl}: tabulka NEEXISTUJE`); continue; }
    const row = r.rows[0];
    if (!row.attname) { problems.push(`${tbl}: sloupec ${col} NEEXISTUJE`); continue; }
    if (row.typ !== 'uuid') { problems.push(`${tbl}.${col}: typ ${row.typ}, cekano uuid`); continue; }
    if (!row.attnotnull) { problems.push(`${tbl}.${col}: je NULLABLE — radky s NULL by neprosly zadnou vetvi`); continue; }
    if (row.npol > 0) { problems.push(`${tbl}: uz ma ${row.npol} policies — neprepisuju cizi rozhodnuti`); continue; }
    ok.push([tbl, col]);
  }
  await c.end();
  return { ok, problems };
}

const uri = opt('url') || process.env.DATABASE_URL;
if (!uri) { console.error('chybi --url='); process.exit(2); }

// ── SELF-CHECK ───────────────────────────────────────────────────────────────
if (flag('selfcheck')) {
  const { problems } = await verify(uri, [BAD, ...TABLES]);
  const caught = problems.some((p) => p.startsWith(`${BAD[0]}:`));
  console.log(`[selfcheck] vlozen spatny vstup: ${BAD[0]} deklarovany se sloupcem ${BAD[1]}`);
  problems.forEach((p) => console.log(`  ODMITNUTO: ${p}`));
  console.log(caught ? '[selfcheck] PROSEL — generator spatny vstup zachytil'
                     : '[selfcheck] SELHAL — generator spatny vstup PROPUSTIL');
  process.exit(caught ? 0 : 1);
}

const { ok, problems } = await verify(uri, TABLES);
if (problems.length) {
  console.error(`\nNEGENERUJI — ${problems.length} tabulek neproslo overenim:`);
  problems.forEach((p) => console.error(`  • ${p}`));
  process.exit(1);
}
if (ok.length !== TABLES.length) { console.error('pocet nesedi'); process.exit(1); }

const header = `--
-- 461_mechanical_rls.sql — RLS na 19 tabulek s primym tenant sloupcem
--
-- VYGENEROVANO skriptem scripts/gen-461-mechanical-rls.mjs z KATALOGU.
-- Needituj rucne — pust generator znovu.
--
-- ── Co to resi (FINDINGS §96) ────────────────────────────────────────────────
-- 189 tabulek z 600 stalo uplne mimo model izolace; 24 z nich neslo tenant data.
-- Unik byl DOLOZEN merenim: promoter A pod tixly_app cetl radek promotera B
-- z catalog.productions. Izolaci drzel jedine WHERE v aplikaci — jedina vrstva.
--
-- Tohle je 19 MECHANICKYCH z tech 24: tenant sloupec je na radku primo a je
-- NOT NULL. Zbylych 5 (b2b_transactions, eudi_verifications, films, sport_teams,
-- fan_bonus_issued) ceka na rozhodnuti — vazba pres JOIN nebo NULLABLE sloupec.
--
-- ── Tvar ─────────────────────────────────────────────────────────────────────
-- Doslova p_orders_scope ze §81:
--   app_is_platform_admin() OR app_is_service() OR <sloupec> = <helper>()
-- app_is_service() tam MUSI byt — checkout, cron a webhooky na cast techto
-- tabulek sahaji a bezi v servisnim kontextu.
--
-- ── FORCE ROW LEVEL SECURITY: ZAMERNE NE ─────────────────────────────────────
-- FORCE podrobuje RLS i VLASTNIKA tabulky. Aplikace se pripojuje jako tixly_app,
-- ktery vlastnikem NENI, takze se ho RLS tyka i bez FORCE. Baseline nema FORCE
-- ani na jedne z 600 tabulek — zavest ho tady by 20 tabulek odlisilo od zbytku
-- a rozbilo migracni/servisni skripty bezici pod ownerem.
--
-- ── Vykon ────────────────────────────────────────────────────────────────────
-- Predikat je rovnost na indexovany sloupec; helper je STABLE, takze se
-- vyhodnoti jednou na dotaz. Zadna korelace = §53 se netyka. 4 z techto tabulek
-- lezi v horke ceste (checkout/scan/webhooks), cena je fakticky nula.
--

BEGIN;
`;

const body = ok.map(([tbl, col]) => {
  const name = `p_${tbl.split('.')[1]}_scope`;
  const pred = `public.app_is_platform_admin() OR public.app_is_service()\n     OR ${col} = public.${HELPER[col]}()`;
  return `
-- ${tbl} :: ${col} (NOT NULL, primy)
ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ${name} ON ${tbl};
CREATE POLICY ${name} ON ${tbl}
  FOR ALL
  USING (${pred})
  WITH CHECK (${pred});`;
}).join('\n');

const out = opt('out', new URL('../../migrations/461_mechanical_rls.sql', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
writeFileSync(out, `${header}${body}\n\nCOMMIT;\n`);
console.log(`[gen] ${ok.length} tabulek overeno proti katalogu → ${out}`);
console.log(`      promoter_id: ${ok.filter((t) => t[1] === 'promoter_id').length} | user_id: ${ok.filter((t) => t[1] === 'user_id').length}`);
