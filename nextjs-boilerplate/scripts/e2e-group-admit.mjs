/**
 * E2E — group admission: JEDEN QR odbaví celou objednávku.
 * Scénář: objednávka 6 lístků → group QR → sken (preview 6 volných) →
 * pustím 5 (jeden přijde později) → ověř 5 used/1 valid → pozdní příchozí:
 * fresh QR → admitAll → 6 used. + cross-tenant + neplatný token.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const BASE = 'http://localhost:3000', ts = Date.now(), PW = 'Demo2026!';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString: (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1], max: 4 });
async function q(s, p = []) { const c = await pool.connect(); try { await c.query(`SET app.role='system'`); return await c.query(s, p); } finally { c.release(); } }
async function api(m, path, { token, body } = {}) {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method: m, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, j };
}
async function login(e) { return (await api('POST', '/api/auth/login', { body: { email: e, password: PW } })).j; }
const R = []; function check(l, c, d = '') { const ok = !!c; R.push({ l, ok }); console.log(`  ${ok ? '✅' : '❌'} ${l}${d ? `  → ${d}` : ''}`); return ok; }
function must(l, c, d = '') { if (!check(l, c, d)) throw new Error(`SETUP: ${l} ${d}`); }

async function main() {
  console.log(`\n═══ E2E GROUP ADMISSION (ts=${ts}) ═══`);
  const ma = await login('superadmin@tixly.cz'); must('Master admin', ma?.roles?.isPlatformAdmin);
  const mk = async (sfx) => { const r = await api('POST', '/api/auth/register-promoter', { body: { email: `ga${sfx}-${ts}@t.cz`, password: PW, name: 'G', companyName: `GA${sfx} ${ts}`, slug: `ga${sfx}-${ts}` } }); await api('POST', `/api/platform/promoters/${r.j.promoterId}/approve`, { token: ma.accessToken }); return (await login(`ga${sfx}-${ts}@t.cz`)).accessToken; };
  const A = await mk('a'), B = await mk('b'); must('Promotér A+B', !!A && !!B);
  const ev = await api('POST', '/api/admin/events', { token: A, body: { title: `GA ${ts}`, description: 'x', category: 'concert', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-22T19:00:00Z', ticketTypes: [{ name: 'Vstup', priceHalire: 30000, capacity: 100, isSeated: false }] } });
  const eid = ev.j?.eventId || ev.j?.id;
  await api('POST', `/api/platform/moderation/${eid}/approve`, { token: ma.accessToken });
  const ttId = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [eid])).rows[0].id;
  // buyer účet
  const bEmail = `gabuyer-${ts}@t.cz`;
  await api('POST', '/api/auth/register', { body: { email: bEmail, password: PW, name: 'Group Buyer' } });
  const buyer = await login(bEmail); must('Buyer účet', !!buyer?.accessToken && !!buyer.user?.id);
  // objednávka 6 lístků + zaplatit
  const co = await api('POST', '/api/checkout', { body: { eventId: eid, ticketTypeId: ttId, quantity: 6, buyerEmail: bEmail, buyerName: 'Group Buyer' } });
  const orderId = co.j?.orderId; must('Checkout 6 lístků', !!orderId, `status=${co.status}`);
  if (co.j?.paymentId) await api('POST', `/api/mock-gopay/${co.j.paymentId}`, { body: { action: 'pay' } });
  // tickety se vystavují async (fire-and-forget) — počkej na ně (poll ~6s)
  let tcount;
  for (let i = 0; i < 12; i++) {
    tcount = (await q(`SELECT count(*) n, count(*) FILTER (WHERE status='valid') v FROM tickets.tickets WHERE order_id=$1`, [orderId])).rows[0];
    if (Number(tcount.v) === 6) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  // přiřaď objednávku buyer účtu (simulace přihlášeného nákupu)
  await q(`UPDATE orders.orders SET user_id=$1 WHERE id=$2`, [buyer.user.id, orderId]);
  must('6 valid lístků v DB', Number(tcount.n) === 6 && Number(tcount.v) === 6, `total=${tcount.n} valid=${tcount.v}`);

  // ── 1. Buyer si vyžádá group QR ────────────────────────────────────────────
  console.log('\n━━━ 1. Group QR (buyer) ━━━');
  const gq = await api('GET', `/api/buyer/orders/${orderId}/group-qr`, { token: buyer.accessToken });
  check('Group QR vydán', gq.status === 200 && !!gq.j?.token, `valid=${gq.j?.validCount}/${gq.j?.totalCount}`);
  const token1 = gq.j?.token;

  // ── 2. Scanner PREVIEW (bez admit) ─────────────────────────────────────────
  console.log('\n━━━ 2. Sken → preview ━━━');
  const prev = await api('POST', '/api/admin/scanner/validate-group', { token: A, body: { orderToken: token1 } });
  check('Preview: 6 lístků, 6 volných', prev.j?.result === 'ok' && prev.j?.counts?.total === 6 && prev.j?.counts?.valid === 6, JSON.stringify(prev.j?.counts));
  check('Preview NIC nepustil (read-only)', prev.j?.admittedCount === 0);
  const ids = (prev.j?.tickets ?? []).map((t) => t.id);

  // ── 3. Pustit 5 z 6 (jeden přijde později) ─────────────────────────────────
  console.log('\n━━━ 3. Pustit 5 (1 pozdě) ━━━');
  const five = ids.slice(0, 5);
  const adm = await api('POST', '/api/admin/scanner/validate-group', { token: A, body: { orderToken: token1, admitTicketIds: five } });
  check('Pustil přesně 5', adm.j?.admittedCount === 5, `admitted=${adm.j?.admittedCount}`);
  check('Po admitu: 5 used / 1 valid', adm.j?.counts?.used === 5 && adm.j?.counts?.valid === 1, JSON.stringify(adm.j?.counts));
  const dbAfter = (await q(`SELECT count(*) FILTER (WHERE status='used') u, count(*) FILTER (WHERE status='valid') v FROM tickets.tickets WHERE order_id=$1`, [orderId])).rows[0];
  check('DB souhlasí (5 used / 1 valid)', Number(dbAfter.u) === 5 && Number(dbAfter.v) === 1, `used=${dbAfter.u} valid=${dbAfter.v}`);

  // ── 4. Idempotence: pustit ty samé znovu nic nepřidá ───────────────────────
  const again = await api('POST', '/api/admin/scanner/validate-group', { token: A, body: { orderToken: token1, admitTicketIds: five } });
  check('Re-admit stejných 5 = 0 nových (idempotentní)', again.j?.admittedCount === 0, `admitted=${again.j?.admittedCount}`);

  // ── 5. Pozdní příchozí: fresh QR → admitAll → 6. used ──────────────────────
  console.log('\n━━━ 5. Pozdní příchozí (admitAll zbytek) ━━━');
  const gq2 = await api('GET', `/api/buyer/orders/${orderId}/group-qr`, { token: buyer.accessToken });
  const late = await api('POST', '/api/admin/scanner/validate-group', { token: A, body: { orderToken: gq2.j.token, admitAll: true } });
  check('AdmitAll pustil posledního 1', late.j?.admittedCount === 1, `admitted=${late.j?.admittedCount}`);
  check('Všech 6 used, 0 volných', late.j?.counts?.used === 6 && late.j?.counts?.valid === 0, JSON.stringify(late.j?.counts));

  // ── 6. Cross-tenant + neplatný token ───────────────────────────────────────
  console.log('\n━━━ 6. Bezpečnost ━━━');
  const gq3 = await api('GET', `/api/buyer/orders/${orderId}/group-qr`, { token: buyer.accessToken });
  const cross = await api('POST', '/api/admin/scanner/validate-group', { token: B, body: { orderToken: gq3.j.token } });
  check('Cizí promotér B → not_found (ownership)', cross.j?.result === 'not_found', `result=${cross.j?.result}`);
  const bad = await api('POST', '/api/admin/scanner/validate-group', { token: A, body: { orderToken: 'aaaaaaaaaa.bbbbbbbbbb.cccccccccc' } });
  check('Neplatný token → invalid', bad.j?.result === 'invalid', `result=${bad.j?.result}`);
  const foreignOrder = await api('GET', `/api/buyer/orders/${orderId}/group-qr`, { token: (await login(`gaa-${ts}@t.cz`).catch(()=>({})))?.accessToken });
  check('Cizí uživatel nedostane group QR cizí objednávky', foreignOrder.status === 404 || foreignOrder.status === 401, `status=${foreignOrder.status}`);

  console.log('\n═══ SOUHRN ═══');
  const pass = R.filter((r) => r.ok).length, fail = R.filter((r) => !r.ok);
  console.log(`${pass}/${R.length} kontrol PROŠLO`);
  if (fail.length) { console.log('\n❌ SELHALO:'); fail.forEach((f) => console.log('   •', f.l)); }
  else console.log('\n🎉 VŠE PROŠLO — jeden QR odbaví celou skupinu, vč. částečného vpuštění a pozdních příchozích.');
}
main().then(() => pool.end()).catch(async (e) => { console.error('\n💥', e.message); await pool.end(); process.exit(1); });
