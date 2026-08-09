/**
 * Deep E2E — batch 3: loyalty, group bookings, vouchers, subscriptions (abonmá).
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const BASE = 'http://localhost:3000', ts = Date.now(), PW = 'Demo2026!';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString: (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1] });
async function q(s, p = []) { const c = await pool.connect(); try { await c.query('BEGIN'); await c.query(`SET LOCAL app.role = 'service'`); const _r = await c.query(s, p); await c.query('COMMIT'); return _r; } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); } }
async function api(method, path, { token, body } = {}) {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
async function login(e) { return (await api('POST', '/api/auth/login', { body: { email: e, password: PW } })).j; }
async function register(e, n) { return api('POST', '/api/auth/register', { body: { email: e, password: PW, name: n } }); }
const results = [];
function check(l, c, d = '') { const ok = !!c; results.push({ l, ok }); console.log(`  ${ok ? '✅' : '❌'} ${l}${d ? `  → ${d}` : ''}`); return ok; }
function must(l, c, d = '') { if (!check(l, c, d)) throw new Error(`SETUP: ${l} ${d}`); }
async function buyAndPay(eid, tt, email, body = {}, token) {
  const co = await api('POST', '/api/checkout', { token, body: { eventId: eid, ticketTypeId: tt, quantity: 1, buyerEmail: email, buyerName: 'B', ...body } });
  if (co.status !== 200) return { ok: false, co };
  await api('POST', `/api/mock-gopay/${co.j.paymentId}`, { body: {} });
  let tid = null;
  for (let i = 0; i < 12; i++) { const t = await q(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [co.j.orderId]); if (t.rows[0]) { tid = t.rows[0].id; break; } await new Promise(r => setTimeout(r, 400)); }
  return { ok: true, orderId: co.j.orderId, ticketId: tid, total: co.j.totalAmount, co: co.j };
}

async function main() {
  console.log(`\n═══ DEEP E2E BATCH 3 (ts=${ts}) ═══`);
  const ma = await login('superadmin@tixly.cz');
  must('Master admin login', ma?.roles?.isPlatformAdmin);
  const reg = await api('POST', '/api/auth/register-promoter', { body: { email: `b3pr-${ts}@t.cz`, password: PW, name: 'P', companyName: `B3 ${ts}`, slug: `b3pr-${ts}` } });
  must('Promotér registrace', reg.status === 200);
  const promoterId = reg.j.promoterId, promoterSlug = `b3pr-${ts}`;
  await api('POST', `/api/platform/promoters/${promoterId}/approve`, { token: ma.accessToken });
  const pr = await login(`b3pr-${ts}@t.cz`);
  must('Promotér login', (pr?.roles?.promoterMemberships?.length ?? 0) > 0);
  // publikovaná akce
  const ev = await api('POST', '/api/admin/events', { token: pr.accessToken, body: { title: `B3 ${ts}`, description: 'x', category: 'music', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-15T19:00:00Z', ticketTypes: [{ name: 'V', priceHalire: 50000, capacity: 100, isSeated: false }] } });
  const eid = ev.j?.eventId || ev.j?.id;
  await api('POST', `/api/platform/moderation/${eid}/approve`, { token: ma.accessToken });
  const tt = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [eid])).rows[0]?.id;
  must('Publikovaná akce', !!eid && !!tt);

  // ── 1. LOYALTY ─────────────────────────────────────────────────────────────
  console.log('\n━━━ 1. Loyalty — body za nákup + uplatnění ━━━');
  const loyEmail = `b3loy-${ts}@t.cz`;
  await register(loyEmail, 'Věrný');
  const loyUser = await login(loyEmail);
  const buy1 = await buyAndPay(eid, tt, loyEmail, {}, loyUser.accessToken);
  must('Loyalty: první nákup', buy1.ok);
  const loyAfter = await api('GET', '/api/buyer/loyalty', { token: loyUser.accessToken });
  const pts = loyAfter.j?.pointsBalance ?? 0;
  check('Loyalty body připsány za nákup', pts > 0, `balance=${pts} lifetime=${loyAfter.j?.lifetimePoints}`);
  if (pts > 0) {
    const redeemPts = Math.min(pts, 50);
    const buy2 = await api('POST', '/api/checkout', { token: loyUser.accessToken, body: { eventId: eid, ticketTypeId: tt, quantity: 1, buyerEmail: loyEmail, buyerName: 'B', redeemLoyaltyPoints: redeemPts } });
    check('Checkout s uplatněním bodů (200)', buy2.status === 200, `status=${buy2.status} ${JSON.stringify(buy2.j?.error||'')}`);
    check(`Body daly slevu (${redeemPts}b = ${redeemPts*100}h)`, buy2.j?.loyaltyDiscountHalire === redeemPts * 100, `discount=${buy2.j?.loyaltyDiscountHalire} total=${buy2.j?.totalAmount}`);
  }

  // ── 2. GROUP BOOKINGS ──────────────────────────────────────────────────────
  console.log('\n━━━ 2. Group bookings — sdílený invite link ━━━');
  const grpEmail = `b3grp-${ts}@t.cz`;
  await register(grpEmail, 'Organizátor');
  const grpUser = await login(grpEmail);
  const gi = await api('POST', '/api/buyer/group-invitations', { token: grpUser.accessToken, body: { eventId: eid, ticketTypeId: tt, targetSeats: 4 } });
  check('Group invite vytvořen', gi.status === 200 && gi.j?.inviteToken, `status=${gi.status} ${JSON.stringify(gi.j?.error||'')}`);
  if (gi.j?.inviteToken) {
    const friendBuy = await api('POST', '/api/checkout', { body: { eventId: eid, ticketTypeId: tt, quantity: 1, buyerEmail: `b3friend-${ts}@t.cz`, buyerName: 'Kamarád', groupInvitationToken: gi.j.inviteToken } });
    check('Kamarád koupil přes group link (200)', friendBuy.status === 200, `status=${friendBuy.status} ${JSON.stringify(friendBuy.j?.error||'')}`);
    if (friendBuy.j?.orderId) {
      const linked = (await q(`SELECT group_invitation_id FROM orders.orders WHERE id=$1`, [friendBuy.j.orderId])).rows[0]?.group_invitation_id;
      check('Objednávka napojena na group invitation', linked === gi.j.invitationId, `linked=${linked?.slice(0,8)}`);
    }
  }

  // ── 3. VOUCHERS ────────────────────────────────────────────────────────────
  console.log('\n━━━ 3. Vouchers — koupě dárkového poukazu + uplatnění ━━━');
  const vbuy = await api('POST', `/api/p/${promoterSlug}/vouchers/checkout`, { body: { amountKc: 300, buyerEmail: `b3vb-${ts}@t.cz`, buyerName: 'Dárce' } });
  check('Voucher koupě iniciována', vbuy.status === 200 && vbuy.j?.voucherCode, `status=${vbuy.status} ${JSON.stringify(vbuy.j?.error||vbuy.j?.detail||'')}`);
  if (vbuy.j?.paymentId) {
    const vconf = await api('POST', `/api/vouchers/holders/${vbuy.j.paymentId}/confirm`, { body: { action: 'pay' } });
    check('Voucher platba potvrzena (paid)', vconf.status === 200 && vconf.j?.paymentStatus === 'paid', `status=${vconf.status} ${JSON.stringify(vconf.j?.error||'')}`);
    // Uplatnit voucher v checkoutu
    const vredeem = await api('POST', '/api/checkout', { body: { eventId: eid, ticketTypeId: tt, quantity: 1, buyerEmail: `b3vr-${ts}@t.cz`, buyerName: 'B', voucherCode: vbuy.j.voucherCode } });
    check('Voucher uplatněn v checkoutu (200)', vredeem.status === 200, `status=${vredeem.status} ${JSON.stringify(vredeem.j?.error||'')}`);
    check('Voucher snížil cenu (300 Kč z 500 → 200 Kč)', vredeem.j?.voucherRedeemedHalire === 30000 && vredeem.j?.totalAmount === 20000, `redeemed=${vredeem.j?.voucherRedeemedHalire} total=${vredeem.j?.totalAmount}`);
  }

  // ── 4. SUBSCRIPTIONS (abonmá / permanentka) ────────────────────────────────
  console.log('\n━━━ 4. Subscriptions — permanentka + uplatnění na akci ━━━');
  const plan = await api('POST', '/api/admin/subscription-plans', { token: pr.accessToken, body: { name: `Abonmá ${ts}`, priceHalire: 200000, billingCycle: 'yearly', allowancePerPeriod: 5 } });
  check('Permanentka (plán) vytvořena', plan.status === 201 && plan.j?.id, `status=${plan.status} ${JSON.stringify(plan.j?.error||plan.j?.issues||'')}`);
  if (plan.j?.id) {
    const subEmail = `b3sub-${ts}@t.cz`;
    await register(subEmail, 'Předplatitel');
    const subUser = await login(subEmail);
    const sub = await api('POST', '/api/subscriptions/subscribe', { token: subUser.accessToken, body: { planId: plan.j.id, buyerEmail: subEmail } });
    check('Předplatné aktivováno', sub.status === 201 && sub.j?.subscriptionId, `status=${sub.status} ${JSON.stringify(sub.j?.error||'')}`);
    // Uplatnit permanentku na akci (stejný promotér) → 100% sleva + spotřeba
    const subBuy = await api('POST', '/api/checkout', { token: subUser.accessToken, body: { eventId: eid, ticketTypeId: tt, quantity: 1, buyerEmail: subEmail, buyerName: 'B', useSubscription: true } });
    check('Checkout přes permanentku (200)', subBuy.status === 200, `status=${subBuy.status} ${JSON.stringify(subBuy.j?.error||'')}`);
    check('Permanentka = 100% sleva (total 0)', subBuy.j?.totalAmount === 0, `total=${subBuy.j?.totalAmount} discount=${subBuy.j?.discountAmount}`);
    if (sub.j?.subscriptionId) {
      const consumed = (await q(`SELECT COUNT(*)::int n FROM subscriptions.consumptions WHERE subscription_id=$1`, [sub.j.subscriptionId])).rows[0]?.n;
      check('Spotřeba permanentky zapsána (1)', consumed === 1, `consumptions=${consumed}`);
    }
  }

  console.log('\n═══ SOUHRN ═══');
  const passed = results.filter(r => r.ok).length, failed = results.filter(r => !r.ok);
  console.log(`${passed}/${results.length} kontrol PROŠLO`);
  if (failed.length) { console.log(`\n❌ SELHALO (${failed.length}):`); failed.forEach(f => console.log(`   • ${f.l}`)); }
  else console.log('\n🎉 VŠE PROŠLO');
}
main().then(() => pool.end()).catch(async e => { console.error('\n💥', e.message); await pool.end(); process.exit(1); });
