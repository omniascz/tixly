/**
 * Dev cleanup — smaže testovací akce/promotéry z e2e/sweep/cdp běhů, které
 * zaplavují katalog (dev demo je pak nepoužitelné: 80 % akcí je „Sweep Akce 178…").
 *
 * BEZPEČNOST: default DRY-RUN (jen vypíše, co by smazal). Reálné smazání:
 *   node scripts/clean-test-data.mjs --apply
 *
 * Maže JEN data odpovídající test patternům (sweep/e2e/cdp/test/14-míst timestamp
 * v názvu nebo slugu). Reálné seed akce (Hamlet, Romeo, festival demo…) NEmaže.
 * Cascade: orders/tickets test promotérů jdou s nimi (FK ON DELETE).
 *
 * Pouze DEV (čte DATABASE_URL_SUPER / DATABASE_URL). NIKDY nespouštět na prod.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const cs =
  (env.match(/^DATABASE_URL_SUPER="?([^"\n]+)"?/m) || [])[1] ||
  (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1];

const APPLY = process.argv.includes('--apply');
const TEST_RE = `(name ~* '(sweep|e2e|cdp|test)' OR name ~ '178[0-9]{10}' OR slug ~* '(sweep|cdp|e2e|test)' OR slug ~ '^[0-9]')`;

async function main() {
  const pool = new pg.Pool({ connectionString: cs });
  const c = await pool.connect();
  try {
    // Test promotéři (přes ně se smažou jejich akce/objednávky cascade FK)
    const proms = await c.query(
      `SELECT id, name, slug FROM platform.promoters WHERE ${TEST_RE.replace(/name/g, 'name').replace(/slug/g, 'slug')}`,
    );
    // Test akce bez test promotéra (samostatné)
    const evs = await c.query(
      `SELECT e.id, e.title FROM catalog.events e
        WHERE (e.title ~* '(sweep|e2e|cdp|test)' OR e.title ~ '178[0-9]{10}')`,
    );

    console.log(`\n═══ Dev cleanup test dat (${APPLY ? 'APPLY' : 'DRY-RUN'}) ═══`);
    console.log(`Test promotéři: ${proms.rows.length}`);
    console.log(`Test akce: ${evs.rows.length}`);
    console.log('Ukázka akcí:', evs.rows.slice(0, 6).map((r) => r.title).join(' | '));

    if (!APPLY) {
      console.log('\n(DRY-RUN — nic nezměněno. Pro skrytí z katalogu: --apply)');
      return;
    }

    // Bezpečné: UNPUBLISH test akcí (status→draft) → zmizí z veřejného katalogu,
    // žádné FK problémy (orders/tickets odkazují events). Data zůstanou v DB.
    // Hard-delete by vyžadoval cascade-ordering napříč mnoha tabulkami (riziko).
    await c.query('BEGIN');
    const hidden = await c.query(
      `UPDATE catalog.events SET status='draft'
        WHERE status='published'
          AND (title ~* '(sweep|e2e|cdp|test)' OR title ~ '178[0-9]{10}'
               OR promoter_id IN (SELECT id FROM platform.promoters WHERE ${TEST_RE}))
        RETURNING id`,
    );
    await c.query('COMMIT');
    console.log(`\n✅ Skryto (unpublish) ${hidden.rows.length} test akcí z veřejného katalogu.`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('💥', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
}
main();
