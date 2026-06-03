/**
 * E2E — destruktivní endpointy (DELETE + destruktivní POST/PATCH).
 * Tyto smoke sweep přeskočil (mažou/mění data). Ověřuje:
 *   1) NEPADAJÍ (5xx = bug),
 *   2) respektují auth/vlastnictví (cizí promotér nesmaže data jiného),
 *   3) klíčové flow (order cancel, moderation reject, promoter suspend) reálně fungují.
 * Vše na throwaway datech (fresh promotér/akce/order per běh).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
const BASE = 'http://localhost:3000', ts = Date.now(), PW = 'Demo2026!';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString: (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1], max: 8 });
async function q(s, p = []) { const c = await pool.connect(); try { await c.query(`SET app.role='service'`); return await c.query(s, p); } finally { c.release(); } }
async function api(method, path, { token, body } = {}) {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`; if (body !== undefined) h['Content-Type'] = 'application/json';
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 12000);
  try { const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; }
  catch (e) { return { status: ctl.signal.aborted ? 408 : -1 }; } finally { clearTimeout(timer); }
}
async function login(e) { return (await api('POST', '/api/auth/login', { body: { email: e, password: PW } })).j; }
function walk(dir, acc = []) { for (const n of readdirSync(dir)) { const f = join(dir, n); if (statSync(f).isDirectory()) walk(f, acc); else if (n === 'route.ts') acc.push(f); } return acc; }
const results = [];
function check(l, c, d = '') { const ok = !!c; results.push({ l, ok }); console.log(`  ${ok ? '✅' : '❌'} ${l}${d ? `  → ${d}` : ''}`); return ok; }
function must(l, c, d = '') { if (!check(l, c, d)) throw new Error(`SETUP: ${l} ${d}`); }

async function main() {
  console.log(`\n═══ E2E DESTRUKTIVNÍ ENDPOINTY (ts=${ts}) ═══`);
  const ma = await login('superadmin@tixly.cz');
  must('Master admin login', ma?.roles?.isPlatformAdmin);
  async function mkPromoter(sfx) { const r = await api('POST', '/api/auth/register-promoter', { body: { email: `de${sfx}-${ts}@t.cz`, password: PW, name: 'D', companyName: `D${sfx} ${ts}`, slug: `de${sfx}-${ts}` } }); await api('POST', `/api/platform/promoters/${r.j.promoterId}/approve`, { token: ma.accessToken }); const lg = await login(`de${sfx}-${ts}@t.cz`); return { promoterId: r.j.promoterId, token: lg.accessToken }; }
  const A = await mkPromoter('a'); const B = await mkPromoter('b');
  must('Promotér A + B', !!A.token && !!B.token);
  const ev = await api('POST', '/api/admin/events', { token: A.token, body: { title: `DE ${ts}`, description: 'x', category: 'music', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-15T19:00:00Z', ticketTypes: [{ name: 'V', priceHalire: 50000, capacity: 100, isSeated: false }] } });
  const eid = ev.j?.eventId || ev.j?.id;
  await api('POST', `/api/platform/moderation/${eid}/approve`, { token: ma.accessToken });
  const ttId = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [eid])).rows[0]?.id;
  // pending order (pro cancel)
  const co = await api('POST', '/api/checkout', { body: { eventId: eid, ticketTypeId: ttId, quantity: 1, buyerEmail: `deb-${ts}@t.cz`, buyerName: 'B' } });
  const orderId = co.j?.orderId;
  must('Setup: akce A + pending order', !!eid && !!orderId);
  const dayId = (await q(`SELECT id FROM catalog.event_days WHERE event_id=$1 LIMIT 1`, [eid])).rows[0]?.id;

  // ── ČÁST 1: Klíčové destruktivní flow (reálné ověření) ──────────────────────
  console.log('\n━━━ 1. Klíčová destruktivní flow ━━━');
  // order cancel (buyer) — guest order; cancel přes mock-gopay cancel action
  const cancel = await api('POST', `/api/mock-gopay/${co.j.paymentId}`, { body: { action: 'cancel' } });
  check('Order cancel → cancelled', cancel.status === 200 && cancel.j?.status === 'cancelled', `status=${cancel.j?.status}`);
  // moderation reject (master admin) — nová akce A do pending
  const ev2 = await api('POST', '/api/admin/events', { token: A.token, body: { title: `DE2 ${ts}`, description: 'x', category: 'music', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-16T19:00:00Z', ticketTypes: [{ name: 'V', priceHalire: 50000, capacity: 50, isSeated: false }] } });
  const eid2 = ev2.j?.eventId || ev2.j?.id;
  const rej = await api('POST', `/api/platform/moderation/${eid2}/reject`, { token: ma.accessToken, body: { reason: 'Test zamítnutí' } });
  check('Moderation reject (master admin) → rejected', rej.status === 200, `status=${rej.status}`);
  check('Akce po reject je rejected v DB', (await q(`SELECT status FROM catalog.events WHERE id=$1`, [eid2])).rows[0]?.status === 'rejected');

  // ── ČÁST 2: Cross-tenant — B nesmí mazat/měnit data A ───────────────────────
  console.log('\n━━━ 2. Cross-tenant ochrana (B nesmí na data A) ━━━');
  const bDelEvent = await api('DELETE', `/api/admin/events/${eid}/days/${dayId}`, { token: B.token });
  check('B NESMÍ mazat den akce A (403/404)', bDelEvent.status === 403 || bDelEvent.status === 404, `status=${bDelEvent.status}`);
  const bEditA = await api('PATCH', `/api/admin/events/${eid}`, { token: B.token, body: { title: 'HACKED' } });
  check('B NESMÍ editovat akci A (403/404)', bEditA.status === 403 || bEditA.status === 404, `status=${bEditA.status}`);
  const bRejected = await api('POST', `/api/platform/moderation/${eid}/reject`, { token: B.token, body: { reason: 'x' } });
  check('B (promotér) NESMÍ na platform moderaci (403)', bRejected.status === 403, `status=${bRejected.status}`);
  check('Akce A pořád published (B nic nezměnil)', (await q(`SELECT status FROM catalog.events WHERE id=$1`, [eid])).rows[0]?.status === 'published');

  // ── ČÁST 3: Sweep všech DELETE — žádná 5xx ──────────────────────────────────
  console.log('\n━━━ 3. Sweep DELETE endpointů (5xx = bug) ━━━');
  const DUMMY = '00000000-0000-4000-a000-000000000001';
  const sub = (s) => ({ '[id]': eid, '[eventId]': eid, '[orderId]': orderId, '[ticketId]': DUMMY, '[dayId]': dayId || DUMMY, '[addonId]': DUMMY, '[fieldId]': DUMMY, '[memberId]': DUMMY, '[userId]': DUMMY, '[reqId]': DUMMY, '[pageId]': DUMMY, '[uid]': DUMMY, '[deviceLibraryId]': DUMMY, '[passTypeId]': 'pass.x', '[serialNumber]': DUMMY }[s] ?? DUMMY);
  const tokenFor = (u) => u.startsWith('/api/platform') ? ma.accessToken : (u.startsWith('/api/admin') || u.startsWith('/api/orders')) ? A.token : u.startsWith('/api/buyer') ? A.token : undefined;
  const API_ROOT = new URL('../src/app/api', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
  const dels = [];
  for (const f of walk(API_ROOT)) { const src = readFileSync(f, 'utf8'); if (!/export\s+(async\s+)?function\s+DELETE/.test(src)) continue; let u = f.slice(f.indexOf('app\\api') >= 0 ? f.indexOf('app\\api') + 7 : f.indexOf('app/api') + 7).replace(/\\/g, '/').replace(/\/route\.ts$/, ''); u = '/api' + u; if (/\/(wallet\/apple|mock-)/.test(u)) continue; dels.push({ url: u, call: u.replace(/\[[a-zA-Z]+\]/g, (m) => sub(m)) }); }
  let delBugs = 0, delOk = 0;
  for (const ep of dels) { const st = (await api('DELETE', ep.call, { token: tokenFor(ep.url) })).status; if (st >= 500) { delBugs++; console.log(`  ❌ ${st}  DELETE ${ep.url}`); } else delOk++; }
  check(`DELETE sweep: ${dels.length} endpointů, žádná 5xx`, delBugs === 0, `${delOk} ok, ${delBugs} bugů`);

  // ── ČÁST 4: Destruktivní POST sweep — žádná 5xx ─────────────────────────────
  console.log('\n━━━ 4. Destruktivní POST/PATCH sweep (5xx = bug) ━━━');
  const dposts = [
    ['POST', `/api/platform/promoters/${B.promoterId}/suspend`, ma.accessToken, { reason: 'test' }],
    ['POST', `/api/admin/facebook/pages/${DUMMY}/disconnect`, A.token, {}],
    ['POST', `/api/buyer/gdpr/delete`, A.token, {}],
    ['DELETE', `/api/buyer/gdpr/delete`, A.token, undefined],
    ['POST', `/api/admin/wristbands/${DUMMY}/charge`, A.token, { amountHalire: 100 }],
    ['POST', `/api/admin/wristbands/${DUMMY}/topup`, A.token, { amountHalire: 100 }],
    ['DELETE', `/api/admin/subscription-plans/${DUMMY}`, A.token, undefined],
    ['DELETE', `/api/admin/team/${DUMMY}`, A.token, undefined],
    ['DELETE', `/api/admin/webhooks/${DUMMY}`, A.token, undefined],
  ];
  let pBugs = 0, pOk = 0;
  for (const [m, u, tok, b] of dposts) { const st = (await api(m, u, { token: tok, body: b })).status; if (st >= 500) { pBugs++; console.log(`  ❌ ${st}  ${m} ${u.replace(/\/[0-9a-f-]{36}\//,'/<id>/')}`); } else pOk++; }
  check(`Destruktivní POST/PATCH sweep: ${dposts.length}, žádná 5xx`, pBugs === 0, `${pOk} ok, ${pBugs} bugů`);
  // suspend reálně suspendoval B?
  check('Promotér B reálně suspendován (master admin akce)', (await q(`SELECT status FROM platform.promoters WHERE id=$1`, [B.promoterId])).rows[0]?.status === 'suspended');

  console.log('\n═══ SOUHRN ═══');
  const passed = results.filter(r => r.ok).length, failed = results.filter(r => !r.ok);
  console.log(`${passed}/${results.length} kontrol PROŠLO`);
  if (failed.length) { console.log(`\n❌ SELHALO (${failed.length}):`); failed.forEach(f => console.log(`   • ${f.l}`)); }
  else console.log('\n🎉 VŠE PROŠLO — destruktivní endpointy nepadají + respektují vlastnictví.');
}
main().then(() => pool.end()).catch(async e => { console.error('\n💥', e.message); await pool.end(); process.exit(1); });
