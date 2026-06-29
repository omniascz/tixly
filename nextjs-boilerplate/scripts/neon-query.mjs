/**
 * Neon production SQL runner (via HTTP API — no DATABASE_URL needed).
 *
 * Usage:
 *   NEON_API_KEY=napi_... node scripts/neon-query.mjs "SELECT 1"
 *   NEON_API_KEY=napi_... node scripts/neon-query.mjs < migrations/380_partner_apply.sql
 *
 * Or pass a migration file:
 *   NEON_API_KEY=napi_... node scripts/neon-query.mjs migrations/380_partner_apply.sql
 */
import { readFile, readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const PROJECT_ID   = 'fragrant-wildflower-75132205';
const BRANCH_ID    = 'br-rough-paper-alom0zky';
const ENDPOINT_HOST = 'ep-weathered-wind-alvbjysw.c-3.eu-central-1.aws.neon.tech';
const DB_NAME      = 'neondb';
const ROLE_NAME    = 'neondb_owner';

const apiKey = process.env.NEON_API_KEY;
if (!apiKey) {
  console.error('❌  Nastav NEON_API_KEY env var');
  process.exit(1);
}

async function getConnStr() {
  const url = `https://console.neon.tech/api/v2/projects/${PROJECT_ID}/connection_uri?branch_id=${BRANCH_ID}&role_name=${ROLE_NAME}&database_name=${DB_NAME}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!r.ok) throw new Error(`Neon API ${r.status}: ${await r.text()}`);
  const { uri } = await r.json();
  return uri;
}

async function runSql(sql, connStr) {
  const r = await fetch(`https://${ENDPOINT_HOST}/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': connStr },
    body: JSON.stringify({ query: sql }),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.message ?? JSON.stringify(json));
  return json;
}

async function main() {
  const connStr = await getConnStr();
  console.log('✓  Connection string obtained');

  let sql;
  const arg = process.argv[2];

  if (arg && arg.endsWith('.sql')) {
    // Run a migration file
    sql = await readFile(arg, 'utf8');
    console.log(`▶  Running ${arg} (${sql.length} chars)`);
  } else if (arg) {
    // Inline SQL from argument
    sql = arg;
  } else {
    // Read from stdin
    const lines = [];
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) lines.push(line);
    sql = lines.join('\n');
  }

  // Split multi-statement SQL into individual statements
  const stmts = sql
    .split(/;[ \t]*(?:--[^\n]*)?(?:\r?\n|$)/)     // split on ; optionally followed by inline comment
    .map(s => s.replace(/--[^\n]*/g, '').trim())  // strip remaining line comments
    .filter(s => s && !/^\/\*/.test(s));           // skip empty + block-comment-only

  if (stmts.length <= 1) {
    const result = await runSql(sql, connStr);
    console.log('✓  Command:', result.command);
    if (result.rows?.length) console.table(result.rows);
    else console.log('   (no rows returned)');
  } else {
    console.log(`   ${stmts.length} statements`);
    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i].trim();
      if (!stmt) continue;
      try {
        const result = await runSql(stmt, connStr);
        console.log(`✓  [${i + 1}/${stmts.length}] ${result.command}`);
      } catch (e) {
        // Already-exists errors are fine for IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
        if (/already exists/i.test(e.message)) {
          console.log(`~  [${i + 1}/${stmts.length}] already exists — skip`);
        } else {
          throw new Error(`Statement ${i + 1} failed: ${e.message}\nSQL: ${stmt.slice(0, 200)}`);
        }
      }
    }
    console.log('✓  All statements done');
  }
}

main().catch(e => { console.error('❌ ', e.message); process.exit(1); });
