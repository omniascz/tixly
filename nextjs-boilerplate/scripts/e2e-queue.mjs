/**
 * E2E — virtuální fronta (onsale gate). Ověřuje, že fronta REÁLNĚ gatuje checkout:
 * bez admitted tokenu se nekoupí; po admitnutí ano. To je ochrana pro hot onsale.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const BASE = process.env.LOAD_BASE ?? 'http://localhost:3000', ts = Date.now(), PW = 'Demo2026!';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString: (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1] });
async function q(s, p = []) { const c = await pool.connect(); try { await c.query(`SET app.role='service'`); return await c.query(s, p); } finally { c.release(); } }
async function api(method, path, { token, body } = {}) {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
async function login(e) { return (await api('POST', '/api/auth/login', { body: { email: e, password: PW } })).j; }
const results = [];
function check(l, c, d = '') { const ok = !!c; results.push({ l, ok }); console.log(`  ${ok ? '✅' : '❌'} ${l}${d ? `  → ${d}` : ''}`); return ok; }
function must(l, c, d = '') { if (!check(l, c, d)) throw new Error(`SETUP: ${l} ${d}`); }

async function main() {
  console.log(`\n═══ E2E VIRTUÁLNÍ FRONTA — onsale gate (ts=${ts}) ═══`);
  const ma = await login('superadmin@tixly.cz');
  must('Master admin login', ma?.roles?.isPlatformAdmin);
  const reg = await api('POST', '/api/auth/register-promoter', { body: { email: `q-${ts}@t.cz`, password: PW, name: 'Q', companyName: `Q ${ts}`, slug: `q-${ts}` } });
  must('Promotér registrace', reg.status === 200);
  await api('POST', `/api/platform/promoters/${reg.j.promoterId}/approve`, { token: ma.accessToken });
  const pr = await login(`q-${ts}@t.cz`);
  const ev = await api('POST', '/api/admin/events', { token: pr.accessToken, body: { title: `Q ${ts}`, description: 'x', category: 'music', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-15T19:00:00Z', ticketTypes: [{ name: 'V', priceHalire: 50000, capacity: 100, isSeated: false }] } });
  const eid = ev.j?.eventId || ev.j?.id;
  // Zapnout frontu na akci (max 2 souběžně)
  const patch = await api('PATCH', `/api/admin/events/${eid}`, { token: pr.accessToken, body: { queueEnabled: true, queueMaxConcurrent: 2 } });
  must('Fronta zapnuta na akci (PATCH)', patch.status === 200, `status=${patch.status}`);
  await api('POST', `/api/platform/moderation/${eid}/approve`, { token: ma.accessToken });
  const tt = (await q(`SELECT tt.id FROM catalog.ticket_types tt WHERE tt.event_id=$1`, [eid])).rows[0]?.id;
  const qEnabled = (await q(`SELECT queue_enabled FROM catalog.events WHERE id=$1`, [eid])).rows[0]?.queue_enabled;
  must('Akce má queue_enabled=true v DB', qEnabled === true, `${qEnabled}`);

  console.log('\n━━━ Test: fronta gatuje checkout ━━━');
  // 1) Checkout BEZ tokenu → musí být odmítnut
  const noTok = await api('POST', '/api/checkout', { body: { eventId: eid, ticketTypeId: tt, quantity: 1, buyerEmail: `qb-${ts}@t.cz`, buyerName: 'B' } });
  check('Checkout BEZ fronty → odmítnut (QUEUE_TOKEN_REQUIRED)', noTok.status === 403 && noTok.j?.error === 'QUEUE_TOKEN_REQUIRED', `status=${noTok.status} err=${noTok.j?.error}`);

  // 2) Připoj se do fronty
  const join = await api('POST', `/api/queue/${eid}/join`, { body: { fingerprint: `fp-${ts}-aaaaaaaa`, formStartedAt: Date.now() - 5000 } });
  check('Připojení do fronty', join.status === 200 && join.j?.token, `status=${join.status} ${JSON.stringify(join.j?.error||'')}`);
  const qtoken = join.j?.token;

  // 3) Poll status → měl by být admitted (jsme první, sloty volné)
  let admitted = false, statusJson = null;
  for (let i = 0; i < 8; i++) {
    const st = await api('GET', `/api/queue/${eid}/status/${qtoken}`);
    statusJson = st.j;
    if (st.j?.status === 'admitted') { admitted = true; break; }
    await new Promise(r => setTimeout(r, 500));
  }
  check('Po pollu fronty → admitted (volný slot)', admitted, `status=${statusJson?.status} position=${statusJson?.position}`);

  // 4) Checkout S admitted tokenem → projde
  if (admitted) {
    const withTok = await api('POST', '/api/checkout', { body: { eventId: eid, ticketTypeId: tt, quantity: 1, buyerEmail: `qb-${ts}@t.cz`, buyerName: 'B', queueToken: qtoken } });
    check('Checkout S admitted tokenem → 200', withTok.status === 200, `status=${withTok.status} ${JSON.stringify(withTok.j?.error||'')}`);
    const tokState = (await q(`SELECT status FROM platform.queue_tokens WHERE id=$1`, [qtoken])).rows[0]?.status;
    check('Token po checkoutu → completed (jednorázový)', tokState === 'completed', `status=${tokState}`);
  }

  // 5) Cizí/neadmitnutý token nelze použít znovu (token už completed)
  const reuse = await api('POST', '/api/checkout', { body: { eventId: eid, ticketTypeId: tt, quantity: 1, buyerEmail: `qb2-${ts}@t.cz`, buyerName: 'B', queueToken: qtoken } });
  check('Použitý token podruhé → odmítnut', reuse.status !== 200, `status=${reuse.status} err=${reuse.j?.error}`);

  console.log('\n═══ SOUHRN ═══');
  const passed = results.filter(r => r.ok).length, failed = results.filter(r => !r.ok);
  console.log(`${passed}/${results.length} kontrol PROŠLO`);
  if (failed.length) { console.log(`\n❌ SELHALO (${failed.length}):`); failed.forEach(f => console.log(`   • ${f.l}`)); }
  else console.log('\n🎉 VŠE PROŠLO — fronta reálně gatuje checkout (onsale ochrana funguje).');
}
main().then(() => pool.end()).catch(async e => { console.error('\n💥', e.message); await pool.end(); process.exit(1); });
