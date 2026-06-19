#!/usr/bin/env node
/**
 * Tixly prod migration runner
 * Spustit přes: vercel env run --environment production -- node scripts/prod-migrate.mjs
 *
 * Přečte DATABASE_URL z prostředí (injektovaný Vercelem), NIKDY ho nevypisuje.
 * Zkontroluje public.schema_migrations a aplikuje chybějící migrace v pořadí.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const MIGRATIONS_DIR = join(ROOT, 'migrations');

const RLS_FLIP = process.argv.includes('--rls-flip');
const DRY_RUN = process.argv.includes('--dry-run');
const FROM = process.argv.find(a => a.startsWith('--from='))?.split('=')[1];

const url = process.env.DATABASE_URL_OPS || process.env.DATABASE_URL;
if (!url) {
  console.error('❌  DATABASE_URL není nastavený — spusť přes: vercel env run --environment production -- node scripts/prod-migrate.mjs');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    // ── Ověř připojení ──────────────────────────────────────────────────────
    const { rows: [ver] } = await client.query('SELECT version()');
    console.log('✓  DB connected:', ver.version.split(' ').slice(0,2).join(' '));

    // ── Stav prod role ───────────────────────────────────────────────────────
    const { rows: roles } = await client.query(
      `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname IN ('tixly_app','tixly')`
    );
    for (const r of roles) {
      console.log(`   role ${r.rolname}: super=${r.rolsuper} bypassrls=${r.rolbypassrls}`);
    }

    // ── Načti aplikované migrace ─────────────────────────────────────────────
    let applied = new Set();
    try {
      const { rows } = await client.query('SELECT version FROM public.schema_migrations ORDER BY version');
      applied = new Set(rows.map(r => r.version));
      console.log(`✓  schema_migrations: ${applied.size} aplikovaných`);
    } catch {
      console.log('⚠  schema_migrations tabulka neexistuje — předpokládám prázdnou DB');
    }

    // ── Načti soubory migrací ────────────────────────────────────────────────
    const files = (await readdir(MIGRATIONS_DIR))
      .filter(f => /^\d+.*\.sql$/.test(f) && !f.startsWith('test_'))
      .sort();

    const pending = files.filter(f => {
      const num = parseInt(f, 10);
      if (FROM && num < parseInt(FROM, 10)) return false;
      return !applied.has(f) && !applied.has(String(num).padStart(3, '0'));
    });

    if (pending.length === 0) {
      console.log('\n✅  Žádné čekající migrace.');
    } else {
      console.log(`\n📋  Čekající migrace (${pending.length}):`);
      for (const f of pending) console.log(`   → ${f}`);

      if (DRY_RUN) {
        console.log('\n⚙  DRY RUN — nic neaplikováno.');
      } else {
        console.log('\n▶  Aplikuji...');
        let ok = 0, fail = 0;
        for (const f of pending) {
          const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
          try {
            await client.query('BEGIN');
            await client.query(sql);
            // Zapiš do tracking tabulky pokud existuje
            try {
              await client.query(
                'INSERT INTO public.schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING',
                [f]
              );
            } catch { /* tabulka neexistuje, ignoruj */ }
            await client.query('COMMIT');
            console.log(`   ✓  ${f}`);
            ok++;
          } catch (err) {
            await client.query('ROLLBACK');
            console.error(`   ✗  ${f}: ${err.message.split('\n')[0]}`);
            fail++;
            // Pokračuj dál (policy migrace jsou idempotentní)
          }
        }
        console.log(`\n${fail === 0 ? '✅' : '⚠ '}  ${ok} OK, ${fail} chyb`);
      }
    }

    // ── RLS flip ─────────────────────────────────────────────────────────────
    if (RLS_FLIP) {
      console.log('\n🔐  RLS flip: ALTER ROLE tixly_app NOBYPASSRLS...');
      if (DRY_RUN) {
        console.log('   DRY RUN — flip přeskočen.');
      } else {
        await client.query('ALTER ROLE tixly_app NOBYPASSRLS');
        const { rows: [r] } = await client.query(
          `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'tixly_app'`
        );
        if (r && r.rolbypassrls === false) {
          console.log('   ✅  RLS AKTIVNÍ — tixly_app NOBYPASSRLS');
        } else {
          console.error('   ❌  Flip selhal — zkontroluj oprávnění superusera');
        }
      }
    }

    // ── Závěrečný stav ───────────────────────────────────────────────────────
    const { rows: [cnt] } = await client.query('SELECT count(*) FROM pg_policies');
    const { rows: [tixApp] } = await client.query(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'tixly_app'`
    );
    console.log(`\n📊  Stav DB:`);
    console.log(`   pg_policies: ${cnt.count}`);
    console.log(`   tixly_app bypassrls: ${tixApp?.rolbypassrls}`);

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('❌  Fatální chyba:', err.message);
  process.exit(1);
});
