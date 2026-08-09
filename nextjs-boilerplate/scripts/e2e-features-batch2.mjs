/**
 * Deep E2E — batch 2: promo kódy, POS, scanner, ticket transfer, insurance.
 * Plný flow proti běžícímu serveru + ověření v DB. 5xx/špatný výsledek = bug.
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
function check(label, cond, detail = '') { const ok = !!cond; results.push({ label, ok }); console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  → ${detail}` : ''}`); return ok; }
function must(label, cond, detail = '') { if (!check(label, cond, detail)) throw new Error(`SETUP: ${label} ${detail}`); }

async function setupEvent(prToken, maToken, extra = {}) {
  const ev = await api('POST', '/api/admin/events', { token: prToken, body: { title: `B2 ${ts}-${Math.round(Math.random()*1e6)}`, description: 'x', category: 'music', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-15T19:00:00Z', ticketTypes: [{ name: 'V', priceHalire: 50000, capacity: 100, isSeated: false }], ...extra } });
  const eid = ev.j?.eventId || ev.j?.id;
  if (eid) await api('POST', `/api/platform/moderation/${eid}/approve`, { token: maToken });
  const tt = eid ? (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [eid])).rows[0]?.id : null;
  return { eid, tt, evStatus: ev.status, evErr: ev.j?.error };
}
async function buyAndPay(eid, tt, email, body = {}) {
  const co = await api('POST', '/api/checkout', { body: { eventId: eid, ticketTypeId: tt, quantity: 1, buyerEmail: email, buyerName: 'B', ...body } });
  if (co.status !== 200) return { ok: false, co };
  await api('POST', `/api/mock-gopay/${co.j.paymentId}`, { body: {} });
  let tid = null;
  for (let i = 0; i < 15; i++) { const t = await q(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [co.j.orderId]); if (t.rows[0]) { tid = t.rows[0].id; break; } await new Promise(r => setTimeout(r, 400)); }
  return { ok: true, orderId: co.j.orderId, ticketId: tid, total: co.j.totalAmount, co: co.j };
}

async function main() {
  console.log(`\n═══ DEEP E2E BATCH 2 (ts=${ts}) ═══`);
  const ma = await login('superadmin@tixly.cz');
  must('Master admin login', ma?.roles?.isPlatformAdmin);
  const reg = await api('POST', '/api/auth/register-promoter', { body: { email: `b2pr-${ts}@t.cz`, password: PW, name: 'P', companyName: `B2 ${ts}`, slug: `b2pr-${ts}` } });
  must('Promotér registrace', reg.status === 200);
  await api('POST', `/api/platform/promoters/${reg.j.promoterId}/approve`, { token: ma.accessToken });
  const pr = await login(`b2pr-${ts}@t.cz`);
  must('Promotér login', (pr?.roles?.promoterMemberships?.length ?? 0) > 0);

  // ── 1. PROMO KÓDY ──────────────────────────────────────────────────────────
  console.log('\n━━━ 1. Promo kódy (sleva v checkoutu) ━━━');
  const base = await setupEvent(pr.accessToken, ma.accessToken);
  must('Akce vytvořena', !!base.eid);
  const code = `SLEVA${ts}`.slice(0, 20).toUpperCase();
  const pc = await api('POST', '/api/admin/promo-codes', { token: pr.accessToken, body: { code, type: 'percentage', discountValue: 20 } });
  check('Promo kód vytvořen (201)', pc.status === 201, `status=${pc.status} ${JSON.stringify(pc.j?.error||pc.j?.issues||'')}`);
  const cobuy = await api('POST', '/api/checkout', { body: { eventId: base.eid, ticketTypeId: base.tt, quantity: 1, buyerEmail: `b2promo-${ts}@t.cz`, buyerName: 'B', promoCode: code } });
  check('Checkout s promo (200)', cobuy.status === 200, `status=${cobuy.status} ${JSON.stringify(cobuy.j?.error||'')}`);
  check('Sleva 20 % aplikována (50000 → 40000)', cobuy.j?.totalAmount === 40000, `total=${cobuy.j?.totalAmount} discount=${cobuy.j?.discountAmount}`);

  // ── 2. POS (walk-in pokladna) ──────────────────────────────────────────────
  console.log('\n━━━ 2. POS — walk-in prodej u dveří ━━━');
  const beforePos = (await q(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [base.tt])).rows[0].remaining_qty;
  const pos = await api('POST', '/api/admin/pos/sale', { token: pr.accessToken, body: { eventId: base.eid, ticketTypeId: base.tt, quantity: 2, buyerName: 'Pan Hotovost', paymentMethod: 'cash' } });
  check('POS prodej (200)', pos.status === 200, `status=${pos.status} ${JSON.stringify(pos.j?.error||pos.j?.message||'')}`);
  check('POS vystavil 2 lístky s TOTP', Array.isArray(pos.j?.tickets) && pos.j.tickets.length === 2 && !!pos.j.tickets[0]?.totpSecretBase32, `${pos.j?.tickets?.length} lístků`);
  if (pos.j?.orderId) { const t = await q(`SELECT COUNT(*)::int n, MAX(status) st FROM orders.orders WHERE id=$1`, [pos.j.orderId]); check('POS order je paid (free provider)', (await q(`SELECT status FROM orders.orders WHERE id=$1`, [pos.j.orderId])).rows[0]?.status === 'paid'); }
  const afterPos = (await q(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [base.tt])).rows[0].remaining_qty;
  check('POS snížil inventář o 2', afterPos === beforePos - 2, `${beforePos} → ${afterPos}`);

  // ── 3. SCANNER (check-in u brány) ──────────────────────────────────────────
  console.log('\n━━━ 3. Scanner — validace lístku u vstupu ━━━');
  const scanSale = await buyAndPay(base.eid, base.tt, `b2scan-${ts}@t.cz`);
  must('Scanner setup: lístek koupen', scanSale.ok && scanSale.ticketId, scanSale.ticketId);
  const scan1 = await api('POST', '/api/admin/scanner/validate', { token: pr.accessToken, body: { ticketId: scanSale.ticketId } });
  check('První sken → admitted', scan1.status === 200 && scan1.j?.result === 'admitted', `status=${scan1.status} result=${scan1.j?.result} ${scan1.j?.message||''}`);
  const dbUsed = (await q(`SELECT status FROM tickets.tickets WHERE id=$1`, [scanSale.ticketId])).rows[0]?.status;
  check('Lístek je v DB used', dbUsed === 'used', dbUsed);
  const scan2 = await api('POST', '/api/admin/scanner/validate', { token: pr.accessToken, body: { ticketId: scanSale.ticketId } });
  check('Druhý sken → already_used (anti-passback)', scan2.j?.result === 'already_used', `result=${scan2.j?.result}`);

  // ── 4. TICKET TRANSFER (P2P dar) ───────────────────────────────────────────
  console.log('\n━━━ 4. Ticket transfer — P2P převod na jiného kupce ━━━');
  const senderEmail = `b2send-${ts}@t.cz`, recipEmail = `b2recip-${ts}@t.cz`;
  await register(senderEmail, 'Odesílatel');
  const sender = await login(senderEmail);
  const tsale = await buyAndPay(base.eid, base.tt, senderEmail);
  must('Transfer setup: odesílatel koupil lístek', tsale.ok && tsale.ticketId);
  const ownerBefore = (await q(`SELECT owner_id FROM tickets.tickets WHERE id=$1`, [tsale.ticketId])).rows[0]?.owner_id;
  const inv = await api('POST', `/api/buyer/tickets/${tsale.ticketId}/transfer-invite`, { token: sender.accessToken, body: { toEmail: recipEmail } });
  check('Transfer invite vytvořen (201)', inv.status === 201, `status=${inv.status} ${JSON.stringify(inv.j?.error||'')}`);
  const token = inv.j?.inviteUrl?.split('/transfer/accept/')[1];
  await register(recipEmail, 'Příjemce');
  const recip = await login(recipEmail);
  const acc = await api('POST', `/api/transfer/accept/${token}`, { token: recip.accessToken });
  check('Příjemce převzal lístek (200)', acc.status === 200 && acc.j?.accepted, `status=${acc.status} ${JSON.stringify(acc.j?.error||'')}`);
  const ownerAfter = (await q(`SELECT owner_id FROM tickets.tickets WHERE id=$1`, [tsale.ticketId])).rows[0]?.owner_id;
  check('Vlastník lístku se změnil na příjemce', ownerAfter && ownerAfter !== ownerBefore, `${ownerBefore?.slice(0,8)} → ${ownerAfter?.slice(0,8)}`);
  const recipUid = (await q(`SELECT id FROM identity.users WHERE email=$1`, [recipEmail])).rows[0]?.id;
  check('Nový vlastník = příjemce', ownerAfter === recipUid);

  // ── 5. INSURANCE / Stornoschutz ────────────────────────────────────────────
  console.log('\n━━━ 5. Insurance — pojištění storna + claim ━━━');
  const insEv = await api('POST', '/api/admin/events', { token: pr.accessToken, body: { title: `B2INS ${ts}`, description: 'x', category: 'music', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-15T19:00:00Z', ticketTypes: [{ name: 'V', priceHalire: 50000, capacity: 100, isSeated: false }] } });
  const insEid = insEv.j?.eventId || insEv.j?.id;
  must('Insurance setup: akce vytvořena', !!insEid);
  const patch = await api('PATCH', `/api/admin/events/${insEid}`, { token: pr.accessToken, body: { insuranceEnabled: true, insurancePct: 10 } });
  check('Pojištění zapnuto na akci (PATCH)', patch.status === 200, `status=${patch.status}`);
  await api('POST', `/api/platform/moderation/${insEid}/approve`, { token: ma.accessToken });
  const insTt = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [insEid])).rows[0]?.id;
  // Registruj kupce předem (reálný účet) → koupí svým tokenem → může claimovat
  const insEmail = `b2ins-${ts}@t.cz`;
  await register(insEmail, 'Pojištěný');
  const insUser = await login(insEmail);
  const insBuy = await buyAndPay(insEid, insTt, insEmail, { insuranceOptIn: true, token: insUser.accessToken });
  check('Nákup s pojistkou (200)', insBuy.ok, `${JSON.stringify(insBuy.co?.j?.error||'')}`);
  const insRow = insBuy.orderId ? (await q(`SELECT premium_amount, status FROM orders.order_insurance WHERE order_id=$1`, [insBuy.orderId])).rows[0] : null;
  check('Pojistka zapsána (premium 10 % = 5000)', insRow?.premium_amount === 5000, `premium=${insRow?.premium_amount} (total byl ${insBuy.total})`);
  const claim = await api('POST', `/api/buyer/orders/${insBuy.orderId}/insurance-claim`, { token: insUser.accessToken, body: { reason: 'Nemoc, nemůžu dorazit' } });
  check('Claim pojistky (200)', claim.status === 200 && claim.j?.ok, `status=${claim.status} ${JSON.stringify(claim.j?.error||claim.j?.message||'')}`);
  if (insBuy.orderId) {
    check('Order po claimu refunded', (await q(`SELECT status FROM orders.orders WHERE id=$1`, [insBuy.orderId])).rows[0]?.status === 'refunded');
    check('Lístky po claimu revoked', (await q(`SELECT status FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [insBuy.orderId])).rows[0]?.status === 'revoked');
  }

  console.log('\n═══ SOUHRN ═══');
  const passed = results.filter(r => r.ok).length, failed = results.filter(r => !r.ok);
  console.log(`${passed}/${results.length} kontrol PROŠLO`);
  if (failed.length) { console.log(`\n❌ SELHALO (${failed.length}):`); failed.forEach(f => console.log(`   • ${f.label}`)); }
  else console.log('\n🎉 VŠE PROŠLO');
}
main().then(() => pool.end()).catch(async e => { console.error('\n💥', e.message); await pool.end(); process.exit(1); });
