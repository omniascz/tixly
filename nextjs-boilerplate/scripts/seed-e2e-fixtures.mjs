/**
 * Seed demo fixtures pro E2E testy, které spoléhají na konkrétní hardcoded ID:
 *   - e2e-guest-hold.mjs  → event 00000000-0000-4000-a000-000000000402 ("Hamlet")
 *                            + 6 konkrétních seatů (A–F)
 *   - e2e-dashboards.mjs  → promotér/user "Divadlo Verze" (…115) + published akce
 *
 * Lokální Docker DB tyhle fixtures má, ale prod-klon (kopie produkce) NE — proto
 * tyhle dva testy proti čerstvému klonu padaly. Tenhle seed je reprodukuje
 * idempotentně (ON CONFLICT DO NOTHING), takže plný E2E jde i proti klonu.
 *
 * Data jsou v seed-e2e-fixtures.sql (vygenerováno z lokálního dema přes
 * quote_nullable → typově bezpečné). Pozn.: Verze membership v demu chybí úplně,
 * proto je v SQL dotvořený ručně (owner/active).
 *
 * Použití:
 *   node scripts/seed-e2e-fixtures.mjs        # čte DATABASE_URL z .env.local
 * Pro prod-klon: nasměruj .env.local na klon a spusť (NIKDY na ostrou produkci —
 * vkládá demo akce Hamlet/Verze).
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const dbUrl = (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1];
if (!dbUrl) {
  console.error('❌ DATABASE_URL nenalezen v .env.local');
  process.exit(1);
}
const sql = readFileSync(new URL('./seed-e2e-fixtures.sql', import.meta.url), 'utf8');

const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });

(async () => {
  const c = await pool.connect();
  try {
    // Service kontext (obejde RLS) + celý seed jako JEDEN multi-statement dotaz.
    // SET LOCAL vyzaduje transakci; seed je stejne jeden celek, takze BEGIN sedi.
    await c.query('BEGIN');
    await c.query(`SET LOCAL app.role = 'service'`);
    await c.query(sql);
    // Overeni MUSI zustat uvnitr transakce — po COMMITu uz servisni kontext
    // neplati (SET LOCAL konci) a RLS by pocty srazila na nulu.
    // Ověření, že fixtures sedí
    const ev = await c.query(
      `SELECT count(*) c FROM catalog.event_seats WHERE event_id = '00000000-0000-4000-a000-000000000402' AND status='available'`,
    );
    const mem = await c.query(
      `SELECT count(*) c FROM platform.promoter_members WHERE user_id = '00000000-0000-4000-a000-000000000115'`,
    );
    await c.query('COMMIT');
    console.log(`✅ Seed hotový — event402 available seats: ${ev.rows[0].c}, Verze membership: ${mem.rows[0].c}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    console.error('❌ Seed selhal:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
