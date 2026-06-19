/**
 * Tixly prod migration runner (inkrementální)
 * Spustit přes: vercel env run -e production -- node scripts/prod-migrate-runner.mjs
 * Pro RLS flip: vercel env run -e production -- node scripts/prod-migrate-runner.mjs rls-flip
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dir = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dir, '..', '..', 'migrations');
const RLS_FLIP = process.argv.includes('rls-flip');

const url = process.env.DATABASE_URL_OPS || process.env.DATABASE_URL || process.env.PROD_DATABASE_URL;
if (!url) {
  console.error('❌  Žádný DATABASE_URL — spusť přes: vercel env run -e production -- node scripts/prod-migrate-runner.mjs');
  process.exit(1);
}
if (url.includes('localhost') || url.includes('5433')) {
  console.error('❌  DATABASE_URL míří na LOCALHOST — to není prod! Přeruším.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });

async function run() {
  const client = await pool.connect();
  try {
    const { rows: [ver] } = await client.query('SELECT version()');
    console.log('✓  DB:', ver.version.split(' ').slice(0,2).join(' '));

    const { rows: roles } = await client.query(
      `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('tixly_app','tixly') ORDER BY rolname`
    );
    for (const r of roles) console.log(`   role ${r.rolname}: bypassrls=${r.rolbypassrls}`);

    // ── Načti aplikované migrace ─────────────────────────────────────────────
    let applied = new Set();
    try {
      const { rows } = await client.query('SELECT version FROM public.schema_migrations ORDER BY version');
      applied = new Set(rows.map(r => String(r.version)));
      console.log(`✓  schema_migrations: ${applied.size} aplikovaných`);
      // Zobraz poslední 5
      const last = rows.slice(-5).map(r => r.version);
      console.log(`   Poslední: ${last.join(', ')}`);
    } catch {
      console.log('⚠  schema_migrations neexistuje — nelze zjistit stav');
    }

    // ── Čekající migrace ─────────────────────────────────────────────────────
    const files = (await readdir(MIGRATIONS_DIR))
      .filter(f => /^\d+.*\.sql$/.test(f) && !f.startsWith('test_') && !f.startsWith('BUNDLE'))
      .sort();

    // Zkus různé formáty klíčů (číslo, filename, padded)
    const isPending = (f) => {
      const num = parseInt(f, 10);
      const padded = String(num).padStart(3, '0');
      return !applied.has(f) && !applied.has(String(num)) && !applied.has(padded) && !applied.has(`${padded}_`);
    };

    const pending = files.filter(isPending);
    console.log(`\n📋  Čekající: ${pending.length} migrací`);
    if (pending.length > 0) {
      // Zobraz čekající (max 30 pro přehled)
      pending.slice(0, 30).forEach(f => console.log(`   → ${f}`));
      if (pending.length > 30) console.log(`   ... a ${pending.length - 30} dalších`);

      console.log('\n▶  Aplikuji...');
      let ok = 0, fail = 0, skipped = 0;
      for (const f of pending) {
        const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
        try {
          await client.query('BEGIN');
          await client.query(sql);
          try {
            await client.query(
              `INSERT INTO public.schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING`,
              [f]
            );
          } catch { /* tracking tabulka možná neexistuje */ }
          await client.query('COMMIT');
          process.stdout.write(`   ✓  ${f}\n`);
          ok++;
        } catch (err) {
          try { await client.query('ROLLBACK'); } catch {}
          const msg = err.message.split('\n')[0];
          // Ignoruj "already exists" chyby (idempotentní policy)
          if (msg.includes('already exists') || msg.includes('duplicate key')) {
            process.stdout.write(`   ↷  ${f} (already exists — skip)\n`);
            skipped++;
            // Zapiš do tracking i přes chybu
            try {
              await client.query(`INSERT INTO public.schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING`, [f]);
            } catch {}
          } else {
            process.stdout.write(`   ✗  ${f}: ${msg}\n`);
            fail++;
          }
        }
      }
      console.log(`\n${fail === 0 ? '✅' : '⚠ '}  ${ok} OK, ${skipped} přeskočeno, ${fail} chyb`);
    } else {
      console.log('✅  Žádné čekající migrace.');
    }

    // ── RLS flip ─────────────────────────────────────────────────────────────
    if (RLS_FLIP) {
      const { rows: [before] } = await client.query(
        `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'tixly_app'`
      );
      if (before?.rolbypassrls === false) {
        console.log('\n✅  RLS już aktivní (NOBYPASSRLS). Nic neprovádím.');
      } else {
        console.log('\n🔐  ALTER ROLE tixly_app NOBYPASSRLS...');
        await client.query('ALTER ROLE tixly_app NOBYPASSRLS');
        const { rows: [after] } = await client.query(
          `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'tixly_app'`
        );
        if (after?.rolbypassrls === false) {
          console.log('   ✅  RLS AKTIVNÍ — tixly_app NOBYPASSRLS');
        } else {
          console.error('   ❌  Flip selhal — nemáš SUPERUSER oprávnění?');
        }
      }
    }

    // ── Závěrečný stav ───────────────────────────────────────────────────────
    const { rows: [cnt] } = await client.query('SELECT count(*) FROM pg_policies');
    const { rows: [tixApp] } = await client.query(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'tixly_app'`
    );
    console.log(`\n📊  Stav DB:`);
    console.log(`   pg_policies celkem: ${cnt.count}`);
    console.log(`   tixly_app bypassrls: ${tixApp?.rolbypassrls} (false = RLS aktivní)`);

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('❌  Fatální:', err.message);
  process.exit(1);
});
