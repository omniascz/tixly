/**
 * Kolo 14 / krok 2 — vzorkování pg_stat_activity během náporu (každých 500 ms): na co čekají spojení aplikace
 * (zámek řádku / I/O / klient). Výstup: souhrn čekání + nejčastější dotazy čekající na zámek.
 *   node load/r14-sample-activity.mjs <sekund> > ../logs/r14/load/activity_<štítek>.json
 */
import pg from 'pg';

const secs = Number(process.argv[2] ?? 90);
const db = new pg.Client({ connectionString: process.env.OWNER_URL ?? 'postgresql://neondb_owner:fixowner@localhost:55632/r14load' });
await db.connect();
const waits = new Map(); const lockQ = new Map(); let samples = 0; let maxActive = 0;
const end = Date.now() + secs * 1000;
while (Date.now() < end) {
  const r = await db.query(`SELECT state, wait_event_type, wait_event, left(regexp_replace(query, '\\s+', ' ', 'g'), 90) AS q
                              FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND usename = 'tixly_app'`);
  samples++;
  const active = r.rows.filter((x) => x.state !== 'idle');
  maxActive = Math.max(maxActive, active.length);
  for (const x of active) {
    const k = `${x.state}|${x.wait_event_type ?? '-'}|${x.wait_event ?? '-'}`;
    waits.set(k, (waits.get(k) ?? 0) + 1);
    if (x.wait_event_type === 'Lock') lockQ.set(x.q, (lockQ.get(x.q) ?? 0) + 1);
  }
  await new Promise((res) => setTimeout(res, 500));
}
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v }));
console.log(JSON.stringify({ samples, maxActive, waits: top(waits, 15), lockWaitQueries: top(lockQ, 10) }, null, 2));
await db.end();
