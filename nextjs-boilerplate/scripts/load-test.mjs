/**
 * ZÁTĚŽOVÝ TEST — simuluje masivní souběžný onsale proti běžícímu serveru.
 *
 * Měří (lokálně ověřitelné):
 *   1) OVERSELL: fire N souběžných checkoutů na kapacitu C → smí projít max C,
 *      remaining_qty nesmí jít do mínusu, žádná 5xx.
 *   2) PROPUSTNOST: latence p50/p95/p99, req/s, error rate pod burstem.
 *   3) STABILITA: kolik 5xx / timeoutů / odmítnutí pod náporem.
 *
 * NEMĚŘÍ: Neon connection limity (lokální PG má jiné), Vercel serverless scaling,
 * produkční build. To jde jen na produkci.
 *
 * Použití: node scripts/load-test.mjs [capacity] [concurrency]
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const BASE = process.env.LOAD_BASE ?? 'http://localhost:3000', ts = Date.now(), PW = 'Demo2026!';
const CAP = Number(process.argv[2] ?? 150);
const N = Number(process.argv[3] ?? 600);
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString: (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1], max: 20 });
async function q(s, p = []) { const c = await pool.connect(); try { await c.query(`SET app.role='service'`); return await c.query(s, p); } finally { c.release(); } }
async function login(e) { const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: PW }) }); return r.json(); }

function pct(arr, p) { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }

async function main() {
  console.log(`\n═══ ZÁTĚŽOVÝ TEST onsale (kapacita=${CAP}, souběžně=${N}) ═══\n`);
  // Setup
  const ma = await login('superadmin@tixly.cz');
  const reg = await (await fetch(`${BASE}/api/auth/register-promoter`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `lt-${ts}@t.cz`, password: PW, name: 'LT', companyName: `LT ${ts}`, slug: `lt-${ts}` }) })).json();
  await fetch(`${BASE}/api/platform/promoters/${reg.promoterId}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${ma.accessToken}` } });
  const pr = await login(`lt-${ts}@t.cz`);
  const ev = await (await fetch(`${BASE}/api/admin/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pr.accessToken}` }, body: JSON.stringify({ title: `LoadTest ${ts}`, description: 'x', category: 'music', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-15T19:00:00Z', ticketTypes: [{ name: 'V', priceHalire: 50000, capacity: CAP, isSeated: false }] }) })).json();
  const eid = ev.eventId || ev.id;
  await fetch(`${BASE}/api/platform/moderation/${eid}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${ma.accessToken}` } });
  const tt = (await q(`SELECT id, remaining_qty FROM catalog.ticket_types WHERE event_id=$1`, [eid])).rows[0];
  console.log(`Setup OK: event ${eid.slice(0, 8)}, kapacita ${tt.remaining_qty}\n`);

  // ── BURST: N souběžných checkoutů NARÁZ ────────────────────────────────────
  console.log(`🔥 Vystřeluji ${N} checkoutů SOUČASNĚ na ${CAP} lístků...`);
  const codes = {}; const lat = []; let firstErr = '';
  const t0 = Date.now();
  const reqs = Array.from({ length: N }, (_, i) => (async () => {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 30000);
    const s = Date.now();
    try {
      const r = await fetch(`${BASE}/api/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: eid, ticketTypeId: tt.id, quantity: 1, buyerEmail: `lt-buyer-${ts}-${i}@t.cz`, buyerName: 'B' }), signal: ctl.signal });
      const ms = Date.now() - s; lat.push(ms);
      codes[r.status] = (codes[r.status] || 0) + 1;
      if (r.status >= 500 && !firstErr) { firstErr = await r.text().catch(() => ''); }
    } catch (e) {
      lat.push(Date.now() - s);
      const k = e.name === 'AbortError' ? 'timeout' : 'neterr';
      codes[k] = (codes[k] || 0) + 1;
    } finally { clearTimeout(timer); }
  })());
  await Promise.all(reqs);
  const wall = Date.now() - t0;

  // ── Ověření v DB ───────────────────────────────────────────────────────────
  const after = (await q(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [tt.id])).rows[0].remaining_qty;
  const ordersMade = (await q(`SELECT COUNT(*)::int n FROM orders.orders WHERE event_id=$1`, [eid])).rows[0].n;
  const success = codes[200] || 0;
  const soldout = codes[409] || 0;
  const err5xx = Object.entries(codes).filter(([k]) => Number(k) >= 500).reduce((a, [, v]) => a + v, 0);
  const timeouts = (codes.timeout || 0) + (codes.neterr || 0);

  console.log(`\n─── VÝSLEDEK BURSTU ───`);
  console.log(`Wall-clock:        ${wall} ms  (${(N / (wall / 1000)).toFixed(0)} req/s)`);
  console.log(`HTTP kódy:         ${JSON.stringify(codes)}`);
  console.log(`Latence:           p50=${pct(lat, 0.5)}ms  p95=${pct(lat, 0.95)}ms  p99=${pct(lat, 0.99)}ms  max=${Math.max(...lat)}ms`);
  console.log(`\n─── KOREKTNOST (oversell) ───`);
  console.log(`Kapacita:          ${CAP}`);
  console.log(`Úspěšných (200):   ${success}`);
  console.log(`Vyprodáno (409):   ${soldout}`);
  console.log(`Orders v DB:       ${ordersMade}`);
  console.log(`remaining_qty:     ${after}`);
  console.log(`\n─── STABILITA ───`);
  console.log(`5xx chyby:         ${err5xx}`);
  console.log(`timeouty/neterr:   ${timeouts}`);
  if (firstErr) console.log(`první 5xx tělo:    ${firstErr.slice(0, 160)}`);

  console.log(`\n═══ VERDIKT ═══`);
  const noOversell = after >= 0 && success <= CAP && ordersMade <= CAP;
  const noCrash = err5xx === 0 && timeouts === 0;
  console.log(`${noOversell ? '✅' : '❌'} OVERSELL: ${noOversell ? `žádný přeprodej (prošlo ${success} ≤ ${CAP}, remaining ${after})` : `PŘEPRODEJ! success=${success} orders=${ordersMade} remaining=${after}`}`);
  console.log(`${noCrash ? '✅' : '❌'} STABILITA: ${noCrash ? 'žádné 5xx ani timeouty pod náporem' : `${err5xx} chyb + ${timeouts} timeoutů — server pod náporem selhával`}`);
  console.log(`📊 PROPUSTNOST: ${(N / (wall / 1000)).toFixed(0)} req/s, p95 latence ${pct(lat, 0.95)}ms`);
}
main().then(() => pool.end()).catch(async e => { console.error('💥', e.message); await pool.end(); process.exit(1); });
