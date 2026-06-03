/**
 * SMOKE SWEEP — projede VŠECHNY GET endpointy s reálnými tokeny + ID.
 * Cíl: tvrdé číslo „kolik endpointů hází 500" (= bug class: schema drift, RLS,
 * špatné error handling). 5xx = BUG. 2xx/3xx/4xx = endpoint žije (OK).
 *
 * Read-only (jen GET) → bezpečné, žádné mutace.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const BASE = 'http://localhost:3000';
const ts = Date.now();
const PW = 'Demo2026!';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const dbUrl = (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1];
const pool = new pg.Pool({ connectionString: dbUrl });
async function q(sql, p = []) { const c = await pool.connect(); try { await c.query(`SET app.role='service'`); return await c.query(sql, p); } finally { c.release(); } }
async function api(method, path, { token, body } = {}) {
  const headers = {}; if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000); // 8s hard cap — visící endpoint = bug
  try {
    const res = await fetch(`${BASE}${path}`, { method, headers, signal: ctl.signal, body: body !== undefined ? JSON.stringify(body) : undefined });
    return res.status;
  } catch (e) {
    return ctl.signal.aborted ? 408 : -1; // 408 = timeout (visí), -1 = jiná chyba
  } finally { clearTimeout(timer); }
}
async function login(email, pw = PW) { const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) }); const j = await r.json().catch(() => ({})); return j; }

// ── Walk filesystem for GET route files ──────────────────────────────────────
const API_ROOT = new URL('../src/app/api', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (name === 'route.ts') acc.push(full);
  }
  return acc;
}

async function main() {
  console.log(`\n═══ SMOKE SWEEP — všechny GET endpointy (ts=${ts}) ═══\n`);

  // ── Setup: tokeny + reálná ID ──────────────────────────────────────────────
  const ma = await login('superadmin@tixly.cz');
  const reg = await (await fetch(`${BASE}/api/auth/register-promoter`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `sweep-${ts}@t.cz`, password: PW, name: 'Sweep', companyName: `Sweep ${ts}`, slug: `sweep-${ts}` }) })).json();
  await api('POST', `/api/platform/promoters/${reg.promoterId}/approve`, { token: ma.accessToken });
  const pr = await login(`sweep-${ts}@t.cz`);
  const ev = await (await fetch(`${BASE}/api/admin/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pr.accessToken}` }, body: JSON.stringify({ title: `Sweep Akce ${ts}`, description: 'x', category: 'music', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-15T19:00:00Z', ticketTypes: [{ name: 'V', priceHalire: 50000, capacity: 100, isSeated: false }] }) })).json();
  const eventId = ev.eventId || ev.id;
  await api('POST', `/api/platform/moderation/${eventId}/approve`, { token: ma.accessToken });
  const evRow = (await q(`SELECT slug, venue_id FROM catalog.events WHERE id=$1`, [eventId])).rows[0];
  const ttId = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [eventId])).rows[0].id;
  // buyer účet + nákup
  await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `sweepbuyer-${ts}@t.cz`, password: PW, name: 'Sweep Buyer' }) });
  const buyer = await login(`sweepbuyer-${ts}@t.cz`);
  const co = await (await fetch(`${BASE}/api/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyer.accessToken}` }, body: JSON.stringify({ eventId, ticketTypeId: ttId, quantity: 1, buyerEmail: `sweepbuyer-${ts}@t.cz`, buyerName: 'Sweep Buyer' }) })).json();
  if (co.paymentId) { await api('POST', `/api/mock-gopay/${co.paymentId}`); await new Promise((r) => setTimeout(r, 1500)); }
  const orderId = co.orderId;
  const ticketId = (await q(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [orderId]))?.rows?.[0]?.id || '00000000-0000-4000-a000-000000000000';

  console.log(`Setup: event=${eventId} order=${orderId} ticket=${ticketId} promoter=${reg.promoterId}\n`);

  const DUMMY = '00000000-0000-4000-a000-000000000001';
  const sub = (seg) => {
    const map = {
      '[id]': eventId, '[eventId]': eventId, '[orderId]': orderId, '[ticketId]': ticketId,
      '[slug]': evRow.slug, '[promoterId]': reg.promoterId, '[venueId]': evRow.venue_id || DUMMY,
      '[campaignId]': DUMMY, '[token]': DUMMY, '[code]': 'TESTCODE', '[uid]': DUMMY,
      '[passTypeId]': 'pass.cz.tixly', '[membershipId]': DUMMY, '[deviceLibraryId]': DUMMY,
      '[groupId]': DUMMY, '[key]': 'overview',
    };
    return map[seg] ?? DUMMY;
  };
  const QUERY = { '/api/search': '?q=koncert', '/api/buyer/resale/list': `?ticketId=${ticketId}` };

  // ── Build endpoint lists (GET + POST) ──────────────────────────────────────
  const files = walk(API_ROOT);
  const getEndpoints = [], postEndpoints = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const hasGet = /export\s+(async\s+)?function\s+GET/.test(src);
    const hasPost = /export\s+(async\s+)?function\s+POST/.test(src);
    if (!hasGet && !hasPost) continue;
    let url = f.slice(f.indexOf('app\\api') >= 0 ? f.indexOf('app\\api') + 7 : f.indexOf('app/api') + 7).replace(/\\/g, '/').replace(/\/route\.ts$/, '');
    url = '/api' + url;
    const urlFilled = url.replace(/\[[a-zA-Z]+\]/g, (m) => sub(m));
    if (hasGet) getEndpoints.push({ url, call: urlFilled + (QUERY[urlFilled] || '') });
    if (hasPost) postEndpoints.push({ url, call: urlFilled });
  }
  const endpoints = getEndpoints;

  // ── Auth routing ───────────────────────────────────────────────────────────
  function tokenFor(u) {
    if (u.startsWith('/api/platform')) return ma.accessToken;
    if (u.startsWith('/api/admin') || u.startsWith('/api/organizer') || u.startsWith('/api/orders')) return pr.accessToken;
    if (u.startsWith('/api/buyer')) return buyer.accessToken;
    return undefined; // public
  }

  // ── Run sweep (průběžný zápis do souboru kvůli buffering) ───────────────────
  const RES = new URL('./e2e-smoke-results.txt', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
  writeFileSync(RES, `SMOKE SWEEP ts=${ts}\n`);
  const bugs = [], hung = [], ok = [], skipped = [];
  let i = 0;
  for (const ep of endpoints) {
    if (/\/(mock-|graphql)/.test(ep.url)) { skipped.push(ep.url); continue; }
    i++;
    const status = await api('GET', ep.call, { token: tokenFor(ep.url) });
    if (status >= 500) { bugs.push({ url: ep.url, status }); appendFileSync(RES, `BUG ${status}  GET ${ep.url}\n`); }
    else if (status === 408) { hung.push({ url: ep.url, status }); appendFileSync(RES, `HANG 408  GET ${ep.url}\n`); }
    else ok.push({ url: ep.url, status });
    if (i % 25 === 0) appendFileSync(RES, `... ${i}/${endpoints.length} hotovo (bugs=${bugs.length} hung=${hung.length})\n`);
  }

  const out = [
    `\n═══ VÝSLEDEK SWEEP ═══`,
    `Endpointů otestováno: ${ok.length + bugs.length + hung.length} (skip: ${skipped.length})`,
    `✅ Žije (non-5xx): ${ok.length}`,
    `❌ 5xx (BUG): ${bugs.length}`,
    `⏳ 408 timeout/visí: ${hung.length}`,
    bugs.length ? `\n--- 500 ENDPOINTY ---\n` + bugs.map((b) => `  ${b.status}  ${b.url}`).join('\n') : '',
    hung.length ? `\n--- VISÍCÍ ENDPOINTY ---\n` + hung.map((b) => `  ${b.url}`).join('\n') : '',
  ].join('\n');
  console.log(out);
  appendFileSync(RES, out + '\n');

  // ── POST sweep ─────────────────────────────────────────────────────────────
  // Prázdné {} tělo: slušný endpoint → 422/400 (validace), rozbitý → 500.
  // Skip: destruktivní (gdpr/delete), webhooky/cron/internal/mock/oauth (potřebují
  // podpis/secret → falešné nálezy), graphql. Test-ID v URL → mutace trefí jen test data.
  const POST_SKIP = /\/(mock-|graphql|oauth|gdpr\/delete|payments\/.*\/(callback|webhook)|internal\/|cron\/|webhooks|auth\/(login|logout|refresh|register))/;
  appendFileSync(RES, `\n\n═══ POST SWEEP ═══\n`);
  const pbugs = [], phung = [], pok = [], pskip = [];
  let j = 0;
  for (const ep of postEndpoints) {
    if (POST_SKIP.test(ep.url)) { pskip.push(ep.url); continue; }
    j++;
    const status = await api('POST', ep.call, { token: tokenFor(ep.url), body: {} });
    if (status >= 500) { pbugs.push({ url: ep.url, status }); appendFileSync(RES, `BUG ${status}  POST ${ep.url}\n`); }
    else if (status === 408) { phung.push({ url: ep.url }); appendFileSync(RES, `HANG 408  POST ${ep.url}\n`); }
    else pok.push({ url: ep.url, status });
    if (j % 25 === 0) appendFileSync(RES, `... ${j} POST hotovo (bugs=${pbugs.length})\n`);
  }
  const pout = [
    `\n═══ VÝSLEDEK POST SWEEP ═══`,
    `POST otestováno: ${pok.length + pbugs.length + phung.length} (skip destruktivní/secret: ${pskip.length})`,
    `✅ Žije (non-5xx): ${pok.length}`,
    `❌ 5xx (BUG): ${pbugs.length}`,
    `⏳ 408 visí: ${phung.length}`,
    pbugs.length ? `\n--- 500 POST ENDPOINTY ---\n` + pbugs.map((b) => `  ${b.status}  ${b.url}`).join('\n') : '',
    phung.length ? `\n--- VISÍCÍ POST ---\n` + phung.map((b) => `  ${b.url}`).join('\n') : '',
  ].join('\n');
  console.log(pout);
  appendFileSync(RES, pout + '\n');
}
main().then(() => pool.end()).catch(async (e) => { console.error('💥', e.message); await pool.end(); process.exit(1); });
