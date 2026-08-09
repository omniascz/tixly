/**
 * Deep E2E — batch 6: gift, bank transfer, BNPL, lottery, donation campaign.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const BASE = 'http://localhost:3000', ts = Date.now(), PW = 'Demo2026!';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString: (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1] });
async function q(s, p = []) { const c = await pool.connect(); try { await c.query('BEGIN'); await c.query(`SET LOCAL app.role = 'service'`); const _r = await c.query(s, p); await c.query('COMMIT'); return _r; } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); } }
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
async function waitTicket(orderId) { for (let i = 0; i < 12; i++) { const t = await q(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [orderId]); if (t.rows[0]) return t.rows[0].id; await new Promise(r => setTimeout(r, 400)); } return null; }

async function main() {
  console.log(`\n═══ DEEP E2E BATCH 6 (ts=${ts}) ═══`);
  const ma = await login('superadmin@tixly.cz');
  must('Master admin login', ma?.roles?.isPlatformAdmin);
  const reg = await api('POST', '/api/auth/register-promoter', { body: { email: `b6pr-${ts}@t.cz`, password: PW, name: 'P', companyName: `B6 ${ts}`, slug: `b6pr-${ts}` } });
  must('Promotér registrace', reg.status === 200);
  await api('POST', `/api/platform/promoters/${reg.j.promoterId}/approve`, { token: ma.accessToken });
  const pr = await login(`b6pr-${ts}@t.cz`);
  must('Promotér login', (pr?.roles?.promoterMemberships?.length ?? 0) > 0);
  const ev = await api('POST', '/api/admin/events', { token: pr.accessToken, body: { title: `B6 ${ts}`, description: 'x', category: 'music', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-15T19:00:00Z', ticketTypes: [{ name: 'V', priceHalire: 50000, capacity: 100, isSeated: false }] } });
  const eid = ev.j?.eventId || ev.j?.id;
  await api('POST', `/api/platform/moderation/${eid}/approve`, { token: ma.accessToken });
  const tt = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [eid])).rows[0]?.id;
  must('Publikovaná akce', !!eid && !!tt);

  // ── 1. GIFT ────────────────────────────────────────────────────────────────
  console.log('\n━━━ 1. Gift — koupě jako dárek + uplatnění příjemcem ━━━');
  const giftBuyer = `b6gb-${ts}@t.cz`, giftRecip = `b6gr-${ts}@t.cz`;
  const gco = await api('POST', '/api/checkout', { body: { eventId: eid, ticketTypeId: tt, quantity: 1, buyerEmail: giftBuyer, buyerName: 'Dárce', giftRecipientEmail: giftRecip, giftRecipientName: 'Příjemce' } });
  must('Gift checkout', gco.status === 200 && gco.j?.orderId);
  await api('POST', `/api/mock-gopay/${gco.j.paymentId}`, { body: {} });
  const giftTid = await waitTicket(gco.j.orderId);
  const giftRow = (await q(`SELECT is_gift, gift_redeem_token FROM orders.orders WHERE id=$1`, [gco.j.orderId])).rows[0];
  check('Objednávka označena jako dárek + má redeem token', giftRow?.is_gift === true && !!giftRow?.gift_redeem_token, `is_gift=${giftRow?.is_gift}`);
  if (giftRow?.gift_redeem_token) {
    const gv = await api('GET', `/api/gift/redeem?token=${giftRow.gift_redeem_token}`);
    check('Gift preview (pending)', gv.status === 200 && gv.j?.status === 'pending', `status=${gv.j?.status}`);
    const ownerBefore = (await q(`SELECT owner_id FROM tickets.tickets WHERE id=$1`, [giftTid])).rows[0]?.owner_id;
    const gr = await api('POST', '/api/gift/redeem', { body: { token: giftRow.gift_redeem_token } });
    check('Příjemce uplatnil dárek (200)', gr.status === 200 && gr.j?.ok, `status=${gr.status} ${JSON.stringify(gr.j?.error||'')}`);
    const ownerAfter = (await q(`SELECT owner_id FROM tickets.tickets WHERE id=$1`, [giftTid])).rows[0]?.owner_id;
    const recipUid = (await q(`SELECT id FROM identity.users WHERE email=$1`, [giftRecip])).rows[0]?.id;
    check('Vlastník lístku převeden na příjemce', ownerAfter === recipUid && ownerAfter !== ownerBefore, `${ownerBefore?.slice(0,8)} → ${ownerAfter?.slice(0,8)}`);
    const gr2 = await api('POST', '/api/gift/redeem', { body: { token: giftRow.gift_redeem_token } });
    check('Opakované uplatnění → 409 ALREADY_REDEEMED', gr2.status === 409);
  }

  // ── 2. BANK TRANSFER (reconcile) ───────────────────────────────────────────
  console.log('\n━━━ 2. Bank transfer — platba převodem + párování ━━━');
  const btco = await api('POST', '/api/checkout', { body: { eventId: eid, ticketTypeId: tt, quantity: 1, buyerEmail: `b6bt-${ts}@t.cz`, buyerName: 'B', paymentMethod: 'bank_transfer' } });
  check('Checkout převodem → variabilní symbol', btco.status === 200 && btco.j?.variableSymbol, `VS=${btco.j?.variableSymbol} total=${btco.j?.totalAmount}`);
  if (btco.j?.variableSymbol) {
    const beforeStatus = (await q(`SELECT status FROM orders.orders WHERE id=$1`, [btco.j.orderId])).rows[0]?.status;
    check('Objednávka je pending (čeká na platbu)', beforeStatus === 'pending', beforeStatus);
    const rec = await api('POST', '/api/admin/bank-transfers/reconcile', { token: pr.accessToken, body: { source: 'manual_csv', lines: [{ amountHalire: btco.j.totalAmount, variableSymbol: btco.j.variableSymbol, payerName: 'Jan Novák' }] } });
    check('Reconcile spároval platbu (matched=1)', rec.status === 200 && rec.j?.matched === 1, `matched=${rec.j?.matched} unmatched=${rec.j?.unmatched}`);
    const afterStatus = (await q(`SELECT status FROM orders.orders WHERE id=$1`, [btco.j.orderId])).rows[0]?.status;
    check('Objednávka po párování → paid', afterStatus === 'paid', afterStatus);
  }

  // ── 3. BNPL (Twisto / Skip Pay) ────────────────────────────────────────────
  console.log('\n━━━ 3. BNPL — odložená platba (Twisto) ━━━');
  const bnco = await api('POST', '/api/checkout', { body: { eventId: eid, ticketTypeId: tt, quantity: 1, buyerEmail: `b6bn-${ts}@t.cz`, buyerName: 'B', paymentMethod: 'twisto' } });
  check('Checkout přes Twisto → BNPL gateway', bnco.status === 200 && (bnco.j?.gatewayUrl||'').includes('mock-bnpl'), `gw=${bnco.j?.gatewayUrl}`);
  if (bnco.j?.paymentId) {
    const conf = await api('POST', `/api/mock-bnpl/twisto/${bnco.j.paymentId}/confirm`, { body: { action: 'approve', installments: 3 } });
    check('BNPL schváleno → paid', conf.status === 200 && conf.j?.status === 'paid', `status=${conf.status} ${JSON.stringify(conf.j?.error||'')}`);
    const bnTid = await waitTicket(bnco.j.orderId);
    check('BNPL → vstupenka vystavena', !!bnTid, `ticket=${bnTid?.slice(0,8)}`);
  }

  // ── 4. LOTTERY (losování) ──────────────────────────────────────────────────
  console.log('\n━━━ 4. Lottery — losování o vstupenky ━━━');
  const lot = await api('POST', `/api/admin/events/${eid}/lotteries`, { token: pr.accessToken, body: { name: `Los ${ts}`, opensAt: '2026-06-01T00:00:00Z', closesAt: '2026-12-01T00:00:00Z', drawAt: '2026-12-02T00:00:00Z', allocationTotal: 10, maxPerEntry: 2 } });
  check('Losování vytvořeno (201)', lot.status === 201 && lot.j?.id, `status=${lot.status} ${JSON.stringify(lot.j?.error||lot.j?.issues||'')}`);
  if (lot.j?.id) {
    // aktivuj (open) — simulace promotér akce / cronu
    const st = (await q(`SELECT status FROM catalog.event_lotteries WHERE id=$1`, [lot.j.id])).rows[0]?.status;
    if (st !== 'open') await q(`UPDATE catalog.event_lotteries SET status='open' WHERE id=$1`, [lot.j.id]);
    const enter = await api('POST', `/api/events/${eid}/lotteries/${lot.j.id}/enter`, { body: { email: `b6lot-${ts}@t.cz`, name: 'Sázkař', ticketTypeId: tt, quantity: 1 } });
    check('Přihlášení do losování (201)', enter.status === 201 && enter.j?.created === true, `status=${enter.status} ${JSON.stringify(enter.j?.error||'')}`);
    const entryDb = (await q(`SELECT COUNT(*)::int n FROM catalog.lottery_entries WHERE lottery_id=$1`, [lot.j.id])).rows[0]?.n;
    check('Entry v DB', entryDb === 1, `${entryDb} entries`);
    const enter2 = await api('POST', `/api/events/${eid}/lotteries/${lot.j.id}/enter`, { body: { email: `b6lot-${ts}@t.cz`, ticketTypeId: tt, quantity: 1 } });
    check('Opakované přihlášení → idempotentní (created=false)', enter2.j?.created === false, `created=${enter2.j?.created}`);
  }

  // ── 5. DONATION CAMPAIGN ───────────────────────────────────────────────────
  console.log('\n━━━ 5. Donation campaign — dárcovská kampaň ━━━');
  const dc = await api('POST', `/api/admin/events/${eid}/donation-campaign`, { token: pr.accessToken, body: { ticketTypeId: tt, name: `Pomoc ${ts}`, minAmountHalire: 10000, goalHalire: 1000000, beneficiaryOrgName: 'Nadace Dobro' } });
  check('Dárcovská kampaň vytvořena', dc.status === 200 || dc.status === 201, `status=${dc.status} ${JSON.stringify(dc.j?.error||dc.j?.issues||'')}`);
  const dcDb = (await q(`SELECT name FROM catalog.donation_campaigns WHERE event_id=$1`, [eid])).rows[0];
  check('Kampaň v DB + ticket_type označen is_donation', !!dcDb, `name=${dcDb?.name}`);
  const isDon = (await q(`SELECT is_donation FROM catalog.ticket_types WHERE id=$1`, [tt])).rows[0]?.is_donation;
  check('ticket_type.is_donation = true', isDon === true, `is_donation=${isDon}`);

  console.log('\n═══ SOUHRN ═══');
  const passed = results.filter(r => r.ok).length, failed = results.filter(r => !r.ok);
  console.log(`${passed}/${results.length} kontrol PROŠLO`);
  if (failed.length) { console.log(`\n❌ SELHALO (${failed.length}):`); failed.forEach(f => console.log(`   • ${f.l}`)); }
  else console.log('\n🎉 VŠE PROŠLO');
}
main().then(() => pool.end()).catch(async e => { console.error('\n💥', e.message); await pool.end(); process.exit(1); });
