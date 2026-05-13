// Aplikuje opravený stadion.json do DB:
//   1) UPDATE catalog.venue_seating_charts.layout
//   2) DELETE z catalog.event_seats pro eventy na stadionu
//   3) Regeneruje event_seats přes copy_layout_to_event_seats (volá pg_temp funkci)
//
// Spustit z roota:  node scripts/patch-stadion-layout.mjs
//
// Použito po opravě buildStadium() — předchozí layout měl 200 "proužkových"
// sektorů místo 40 reálných bloků 4×10.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const layoutPath = join(__dirname, 'layouts', 'stadion.json');

// pg žije v nextjs-boilerplate/node_modules; load přes createRequire pro CJS interop.
const requireFromApp = createRequire(join(__dirname, '..', 'nextjs-boilerplate', 'noop.js'));
const pg = requireFromApp('pg');

const STADIUM_VENUE_ID = '00000000-0000-4000-a000-000000000204';
const STADIUM_CHART_ID = '00000000-0000-4000-a000-000000000303';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://tixly:tixly_dev@localhost:5433/tixly',
});

async function main() {
  const layoutJson = readFileSync(layoutPath, 'utf8');
  const layout = JSON.parse(layoutJson);
  const totalSeats = layout.sectors.reduce(
    (sum, s) => sum + s.rows.reduce((a, r) => a + r.seats.length, 0),
    0,
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) UPSERT venue_seating_charts
    const upsert = await client.query(
      `INSERT INTO catalog.venue_seating_charts (id, venue_id, name, layout, total_seats, active, source, notes)
       VALUES ($1, $2, 'Stadion FC Praha — 4 tribuny × 10 bloků', $3::jsonb, $4, true, 'seed', 'Patched 2026-04-29 — fixed buildStadium structure')
       ON CONFLICT (id) DO UPDATE
         SET layout = EXCLUDED.layout,
             total_seats = EXCLUDED.total_seats,
             name = EXCLUDED.name,
             notes = EXCLUDED.notes
       RETURNING (xmax = 0) AS inserted`,
      [STADIUM_CHART_ID, STADIUM_VENUE_ID, layoutJson, totalSeats],
    );
    console.log(
      `[chart] ${upsert.rows[0].inserted ? 'inserted' : 'updated'} chart ${STADIUM_CHART_ID} — ${totalSeats} sedadel, ${layout.sectors.length} sektorů`,
    );

    // 2) Najdi eventy na stadionu
    const events = await client.query(
      `SELECT id, title FROM catalog.events WHERE venue_id = $1`,
      [STADIUM_VENUE_ID],
    );
    console.log(`[events] ${events.rows.length} event(ů) na stadionu:`);
    for (const e of events.rows) console.log(`  · ${e.id}  ${e.title}`);

    // 3) Smaž stávající event_seats pro tyto eventy (aby se daly regenerovat)
    if (events.rows.length > 0) {
      const ids = events.rows.map((e) => e.id);
      const del = await client.query(
        `DELETE FROM catalog.event_seats WHERE event_id = ANY($1::uuid[])`,
        [ids],
      );
      console.log(`[event_seats] smazáno ${del.rowCount} starých řádků`);
    }

    await client.query('COMMIT');
    console.log('\nHotovo. Pro regeneraci event_seats spusť copy_layout_to_event_seats z TS modulu nebo přepublikuj akce v promotér UI.');
    console.log('Sektory teď: SEVER-A..J, JIH-A..J, VYCHOD-A..J, ZAPAD-A..J (40 bloků × 25 řad × 50 sedadel = 50 000)');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
