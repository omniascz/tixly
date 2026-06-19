/**
 * Fix: vytvoří chybějící 'communications' schema na prod DB a re-aplikuje
 * migrace 364 + 378 které na něj závisí.
 *
 * Spustit: node scripts/prod-fix-communications.mjs
 * (se $env:PROD_DATABASE_URL nastaveným)
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dir = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dir, '..', '..', 'migrations');

const url = process.env.DATABASE_URL_OPS || process.env.DATABASE_URL || process.env.PROD_DATABASE_URL;
if (!url || url.includes('localhost')) {
  console.error('❌  Nastav PROD_DATABASE_URL (ne localhost)'); process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });

async function run() {
  const client = await pool.connect();
  try {
    console.log('▶  Vytvářím communications schema...');
    await client.query('CREATE SCHEMA IF NOT EXISTS communications');
    console.log('✓  communications schema OK');

    const toFix = ['364_emergency_announcements.sql', '378_import_broadcasts.sql'];
    for (const f of toFix) {
      const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        console.log(`✓  ${f}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`✗  ${f}: ${err.message.split('\n')[0]}`);
      }
    }

    // INDEX CONCURRENTLY migrace — musí běžet mimo transakci
    const concurrentlyMigs = ['284_promoter_indexes.sql', '328_schema_hygiene.sql'];
    console.log('\n▶  INDEX CONCURRENTLY migrace (bez transakce)...');
    for (const f of concurrentlyMigs) {
      const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
      // Rozděl na příkazy a spusť každý zvlášť (přeskoč ty co selžou)
      const statements = sql.split(/;\s*\n/).filter(s => s.trim());
      let ok = 0, skip = 0;
      for (const stmt of statements) {
        if (!stmt.trim()) continue;
        try {
          await client.query(stmt);
          ok++;
        } catch (err) {
          const msg = err.message.split('\n')[0];
          if (msg.includes('already exists') || msg.includes('duplicate')) skip++;
          else console.log(`   ↷  ${msg}`);
        }
      }
      console.log(`✓  ${f}: ${ok} příkazů OK, ${skip} přeskočeno`);
    }

    const { rows: [cnt] } = await client.query('SELECT count(*) FROM pg_policies');
    console.log(`\n📊  pg_policies celkem: ${cnt.count}`);
    console.log('✅  Hotovo');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
