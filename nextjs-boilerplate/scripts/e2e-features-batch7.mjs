/**
 * Deep E2E — batch 7: affiliate (provize), RFID wristband (cashless), white-label branding.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const BASE = 'http://localhost:3000', ts = Date.now(), PW = 'Demo2026!';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString: (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1] });
async function q(s, p = []) { const c = await pool.connect(); try { await c.query(`SET app.role='service'`); return await c.query(s, p); } finally { c.release(); } }
async function api(method, path, { token, body } = {}) {
  const h = { 'X-Forwarded-For': '77.'+((Date.now()>>8)%256)+'.'+(Math.floor(Math.random()*256))+'.'+(Math.floor(Math.random()*256)) }; if (token) h.Authorization = `Bearer ${token}`; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
async function login(e) { return (await api('POST', '/api/auth/login', { body: { email: e, password: PW } })).j; }
const results = [];
function check(l, c, d = '') { const ok = !!c; results.push({ l, ok }); console.log(`  ${ok ? '✅' : '❌'} ${l}${d ? `  → ${d}` : ''}`); return ok; }
function must(l, c, d = '') { if (!check(l, c, d)) throw new Error(`SETUP: ${l} ${d}`); }
async function buyAndPay(eid, tt, email, body = {}) {
  const co = await api('POST', '/api/checkout', { body: { eventId: eid, ticketTypeId: tt, quantity: 1, buyerEmail: email, buyerName: 'B', ...body } });
  if (co.status !== 200) return { ok: false, co };
  await api('POST', `/api/mock-gopay/${co.j.paymentId}`, { body: {} });
  let tid = null;
  for (let i = 0; i < 12; i++) { const t = await q(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [co.j.orderId]); if (t.rows[0]) { tid = t.rows[0].id; break; } await new Promise(r => setTimeout(r, 400)); }
  return { ok: true, orderId: co.j.orderId, ticketId: tid, total: co.j.totalAmount };
}

async function main() {
  console.log(`\n═══ DEEP E2E BATCH 7 (ts=${ts}) ═══`);
  const ma = await login('superadmin@tixly.cz');
  must('Master admin login', ma?.roles?.isPlatformAdmin);
  const reg = await api('POST', '/api/auth/register-promoter', { body: { email: `b7pr-${ts}@t.cz`, password: PW, name: 'P', companyName: `B7 ${ts}`, slug: `b7pr-${ts}` } });
  must('Promotér registrace', reg.status === 200);
  const slug = `b7pr-${ts}`;
  await api('POST', `/api/platform/promoters/${reg.j.promoterId}/approve`, { token: ma.accessToken });
  const pr = await login(`b7pr-${ts}@t.cz`);
  must('Promotér login', (pr?.roles?.promoterMemberships?.length ?? 0) > 0);
  const ev = await api('POST', '/api/admin/events', { token: pr.accessToken, body: { title: `B7 ${ts}`, description: 'x', category: 'music', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-15T19:00:00Z', ticketTypes: [{ name: 'V', priceHalire: 50000, capacity: 100, isSeated: false }] } });
  const eid = ev.j?.eventId || ev.j?.id;
  await api('POST', `/api/platform/moderation/${eid}/approve`, { token: ma.accessToken });
  const tt = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [eid])).rows[0]?.id;
  must('Publikovaná akce', !!eid && !!tt);

  // ── 1. AFFILIATE (provizní program) ────────────────────────────────────────
  console.log('\n━━━ 1. Affiliate — provizní program ━━━');
  const affCode = `AFF${ts}`.slice(0, 20).toUpperCase();
  const aff = await api('POST', '/api/admin/affiliates', { token: pr.accessToken, body: { code: affCode, name: 'Influencer Pepa', commissionPct: 10 } });
  check('Affiliate vytvořen (201)', aff.status === 201 && aff.j?.id, `status=${aff.status} ${JSON.stringify(aff.j?.error||aff.j?.issues||'')}`);
  const affBuy = await buyAndPay(eid, tt, `b7aff-${ts}@t.cz`, { affiliateCode: affCode });
  check('Nákup přes affiliate kód', affBuy.ok, `${JSON.stringify(affBuy.co?.j?.error||'')}`);
  if (affBuy.orderId) {
    const ord = (await q(`SELECT affiliate_id, affiliate_commission_minor FROM orders.orders WHERE id=$1`, [affBuy.orderId])).rows[0];
    check('Objednávka napojena na affiliate', !!ord?.affiliate_id, `aff_id=${ord?.affiliate_id?.slice(0,8)}`);
    check('Provize 10 % = 5000 haléřů spočtena', Number(ord?.affiliate_commission_minor) === 5000, `commission=${ord?.affiliate_commission_minor}`);
  }
  const affList = await api('GET', '/api/admin/affiliates', { token: pr.accessToken });
  const affRow = (affList.j?.affiliates || []).find(a => a.code === affCode);
  check('Affiliate stats: 1 objednávka', affRow?.orders_count === 1, `orders=${affRow?.orders_count} commission=${affRow?.commission_total}`);
  const affDup = await api('POST', '/api/admin/affiliates', { token: pr.accessToken, body: { code: affCode, name: 'Druhý pokus', commissionPct: 5 } });
  check('Duplicitní kód → 409', affDup.status === 409, `status=${affDup.status}`);

  // ── 2. RFID WRISTBAND (cashless platby) ────────────────────────────────────
  console.log('\n━━━ 2. RFID wristband — cashless na festivalu ━━━');
  const wbSale = await buyAndPay(eid, tt, `b7wb-${ts}@t.cz`);
  must('Wristband setup: lístek koupen', wbSale.ok && wbSale.ticketId);
  const uid = `04A1B2C3${ts}`.slice(0, 32);
  const bind = await api('POST', '/api/admin/wristbands/bind', { token: pr.accessToken, body: { ticketId: wbSale.ticketId, uid, initialTopupHalire: 50000 } });
  check('Páska spárována s lístkem + nabito 500 Kč', bind.status === 200 && bind.j?.balanceHalire === 50000, `status=${bind.status} balance=${bind.j?.balanceHalire} ${JSON.stringify(bind.j?.error||'')}`);
  if (bind.status === 200) {
    const charge1 = await api('POST', `/api/admin/wristbands/${uid}/charge`, { token: pr.accessToken, body: { amountHalire: 12000, vendorLabel: 'Bar Stage A', description: 'Pivo' } });
    check('Nákup u baru (120 Kč) → balance 380 Kč', charge1.status === 200 && charge1.j?.balanceHalire === 38000, `balance=${charge1.j?.balanceHalire}`);
    const dbBal = (await q(`SELECT balance_halire FROM tickets.wristbands WHERE uid=$1`, [uid])).rows[0]?.balance_halire;
    check('Zůstatek v DB = 38000', dbBal === 38000, `db=${dbBal}`);
    const charge2 = await api('POST', `/api/admin/wristbands/${uid}/charge`, { token: pr.accessToken, body: { amountHalire: 99999999, vendorLabel: 'Bar' } });
    check('Nákup nad zůstatek → INSUFFICIENT_BALANCE (409)', charge2.status === 409 && charge2.j?.error === 'INSUFFICIENT_BALANCE', `status=${charge2.status}`);
    const txCount = (await q(`SELECT COUNT(*)::int n FROM tickets.wristband_transactions WHERE wristband_uid=$1`, [uid])).rows[0]?.n;
    check('Transakce zaznamenány (topup + purchase = 2)', txCount === 2, `${txCount} transakcí`);
  }

  // ── 3. WHITE-LABEL BRANDING ────────────────────────────────────────────────
  console.log('\n━━━ 3. White-label — vlastní branding promotéra ━━━');
  const brand = await api('PUT', '/api/admin/branding', { token: pr.accessToken, body: { primaryColor: '#ff5500', accentColor: '#0055ff', hidePoweredBy: true, metaTitle: `Divadlo ${ts}` } });
  check('Branding uložen (PUT 200)', brand.status === 200 && brand.j?.ok, `status=${brand.status} ${JSON.stringify(brand.j?.error||'')}`);
  const brandGet = await api('GET', '/api/admin/branding', { token: pr.accessToken });
  check('Branding se načte zpět (primary color)', brandGet.j?.branding?.primary_color === '#ff5500', `color=${brandGet.j?.branding?.primary_color}`);
  check('Hide "powered by" = true', brandGet.j?.branding?.hide_powered_by === true);
  // Public endpoint by slug
  const pub = await api('GET', `/api/public/branding?slug=${slug}`);
  check('Public branding endpoint vrací data (white-label)', pub.status === 200, `status=${pub.status} ${JSON.stringify(pub.j).slice(0,80)}`);

  console.log('\n═══ SOUHRN ═══');
  const passed = results.filter(r => r.ok).length, failed = results.filter(r => !r.ok);
  console.log(`${passed}/${results.length} kontrol PROŠLO`);
  if (failed.length) { console.log(`\n❌ SELHALO (${failed.length}):`); failed.forEach(f => console.log(`   • ${f.l}`)); }
  else console.log('\n🎉 VŠE PROŠLO');
}
main().then(() => pool.end()).catch(async e => { console.error('\n💥', e.message); await pool.end(); process.exit(1); });
