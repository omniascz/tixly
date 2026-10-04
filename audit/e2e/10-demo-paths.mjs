// E2E 10: "demo" prodejni cesty, ktere v produkcnim rezimu (NODE_ENV=production, mock brana 403)
// vystavi placenou vstupenku / dobijou zustatek BEZ jakekoli platby a (u voucher/subscription)
// BEZ autentizace. Cil: dotahnout kazdou cestu az do DB ground truth, ne jen dosazitelnost endpointu.
// Predpoklad: bezi app na :3100 (tixly_app, NODE_ENV=production), fake-gopay na :3999 (nesmi byt volano).
import { readFileSync } from 'node:fs';
import { randomUUID as randomUUIDish } from 'node:crypto';
import { Client, q, owner, check, ev, startLog, summary, gopayLog, scenarioBuyer } from './lib.mjs';

startLog('10_demo_paths');
const S = JSON.parse(readFileSync(new URL(process.env.AUDIT_STATE ?? './state.json', import.meta.url), 'utf8'));
const login = async (email) => { const c = new Client('u'); const r = await c.post('/api/auth/login', { email, password: S.pw }); if (r.status !== 200) throw new Error(`login ${email} ${r.status}`); return c; };
const anon = () => new Client('anon');
const gopayCallCount = async () => (await gopayLog()).filter((x) => x.path?.startsWith('/api/payments/payment')).length;

// kolo 2: vlastni kupec na scenar (per-e-mail/per-IP limit checkoutu z K3)
const sD = await scenarioBuyer(S, `D-${Date.now().toString(36)}`);
const buyer = sD.c;
const PA = await login(S.promoterA.email);
const slug = (await q(`SELECT slug FROM platform.promoters WHERE id=$1`, [S.promoterA.id]))[0].slug;

// Pomocna: cisty nakup 1 vstupenky pres GoPay flow (owner ma valid ticket k upgrade/resale).
const webhook = (pid) => new Client('gopay-notify').get(`/api/payments/gopay/webhook?id=${pid}`);
async function buyOne(ticketTypeId) {
  const gopayCtl = async (id, body) => (await fetch(`${process.env.FAKE_GOPAY ?? 'http://localhost:3999'}/_ctl/${id}`, { method: 'POST', body: JSON.stringify(body) })).json();
  const r = await buyer.post('/api/checkout', { eventId: S.eventA, ticketTypeId, quantity: 1, buyerEmail: sD.email, buyerName: 'Kupec Audit' });
  if (r.status !== 200) throw new Error('buyOne checkout ' + r.status + ' ' + r.text);
  await gopayCtl(r.json.paymentId, { state: 'PAID' });
  await webhook(r.json.paymentId);
  for (let i = 0; i < 40; i++) { const t = await q(`SELECT id FROM tickets.tickets WHERE order_id=$1`, [r.json.orderId]); if (t.length) return { orderId: r.json.orderId, ticketId: t[0].id }; await new Promise((x) => setTimeout(x, 500)); }
  throw new Error('buyOne no ticket issued');
}

// ============ D1: upgrade — vlastnik lístku upgradne na dražší typ bez platby ============
// Potrebujeme drazsi cilovy typ nez soucasny (Stani 500 Kc). Zalozime VIP 1000 Kc.
const vip = await PA.post(`/api/admin/events/${S.eventA}/ticket-types`, { name: `VIP ${S.run}`, priceHalire: 100000, vatRateCode: 'CZ_REDUCED', totalQty: 20 });
const vipId = vip.json?.id;
const base = await buyOne(S.tt['Stani']); // valid Stani ticket (500 Kc)
const before1 = await gopayCallCount();
// Neprihlaseny utocnik zna jen UUID listku + e-mail vlastnika (oboji unika napr. pres IDOR upgrade GET, viz S2).
let r = await anon().post(`/api/buyer/tickets/${base.ticketId}/upgrade`, { targetTicketTypeId: vipId, ownerEmail: sD.email });
let tkAfter = (await q(`SELECT tt.name, tt2.base_price FROM tickets.tickets t JOIN catalog.ticket_types tt2 ON tt2.id=t.ticket_type_id JOIN catalog.ticket_types tt ON tt.id=t.ticket_type_id WHERE t.id=$1`, [base.ticketId]))[0];
let upOrder = (await q(`SELECT status, payment_provider, total_amount FROM orders.orders WHERE idempotency_key IS NOT NULL AND id IN (SELECT order_id FROM orders.order_items WHERE ticket_type_id=$1) AND status='paid' ORDER BY created_at DESC LIMIT 1`, [vipId]))[0] ?? null;
const after1 = await gopayCallCount();
check('D1', 'UPGRADE: neprihlaseny (jen ownerEmail+ticketId) upgradne lístek na dražší typ, vznikne paid objednávka a lístek zdraží — BEZ platby',
  !(r.status === 200 && tkAfter?.base_price === 100000 && upOrder?.status === 'paid' && after1 === before1),
  { status: r.status, body: JSON.stringify(r.json).slice(0, 200), ticketTypeNow: tkAfter, upgradeOrder: upOrder, gopayCallsDelta: after1 - before1 });

// ============ D2: voucher — checkout + confirm bez auth = dobity zustatek bez platby ============
const before2 = await gopayCallCount();
r = await anon().post(`/api/p/${slug}/vouchers/checkout`, { amountKc: 2000, buyerEmail: `voucher-${S.run}@audit.test`, buyerName: 'Voucher Buyer' });
const vPid = r.json?.paymentId;
const confirm = vPid ? await anon().post(`/api/vouchers/holders/${vPid}/confirm`, { action: 'pay' }) : { status: 0, json: null };
const vRow = vPid ? (await q(`SELECT payment_status, balance_halire, amount_halire, paid_order_id FROM marketing.gift_vouchers WHERE payment_id=$1`, [vPid]))[0] : null;
const after2 = await gopayCallCount();
check('D2', 'VOUCHER: bez auth checkout+confirm → voucher payment_status=paid s utratitelným zůstatkem, BEZ platby',
  !(confirm.status === 200 && vRow?.payment_status === 'paid' && Number(vRow?.balance_halire) > 0 && after2 === before2),
  { checkoutStatus: r.status, confirmStatus: confirm.status, voucher: vRow, gopayCallsDelta: after2 - before2 });

// ============ D3: subscription — checkout + confirm bez auth = aktivni predplatne + vstupenky ============
// Nejdriv admin zalozi fixed abo balicek on_sale s 1 akci (event A).
const uniq = `${S.run}-${Date.now().toString(36)}`;
const pkg = await PA.post('/api/admin/subscriptions/packages', { name: `Abo ${uniq}`, slug: `abo-${uniq}`, seasonLabel: '25/26', basePriceHalire: 300000, aboType: 'fixed', eventIds: [S.eventA] });
const pkgId = pkg.json?.id;
if (pkgId) await q(`UPDATE subscriptions.packages SET status='on_sale' WHERE id=$1`, [pkgId]).catch(() => {});
// Overeni pres oficialni /api/subscriptions/checkout — zaznamename, zda vubec projde.
const chk = pkgId ? await anon().post('/api/subscriptions/checkout', { packageId: pkgId, buyerEmail: `abo-${S.run}@audit.test`, buyerName: 'Abo Buyer' }) : { status: 0, json: null };
check('D3a', 'SUBSCRIPTION: oficiální checkout /api/subscriptions/checkout funguje (n-preduskuje mock confirm)',
  chk.status === 200 && !!chk.json?.paymentId,
  { checkoutStatus: chk.status, body: JSON.stringify(chk.json ?? '').slice(0, 200) });
// Checkout 500-uje (ON CONFLICT drift) → holder nevznikne cestou aplikace. Abychom overili SAMOTNY
// neautentizovany confirm endpoint, nasadime holder v pending stavu primo (owner/bypass) a zavolame confirm jako anon.
const sPid = randomUUIDish();
const buyerRow = (await q(`SELECT id FROM identity.users WHERE email=$1`, [sD.email]))[0];
await q(`INSERT INTO subscriptions.holders (id, package_id, user_id, holder_name, holder_email, valid_until, price_paid_halire, currency, status, payment_status, payment_id, payment_provider)
         VALUES (gen_random_uuid(), $1, $2, 'Abo Direct', $3, NOW()+INTERVAL '1 year', 300000, 'CZK', 'pending_payment', 'pending', $4, 'mock')`,
        [pkgId, buyerRow.id, `abo-direct-${S.run}@audit.test`, sPid]).catch((e) => check('D3-seed', 'seed holderu', false, { err: e.message }));
const before3 = await gopayCallCount();
const sConfirm = await anon().post(`/api/subscriptions/holders/${sPid}/confirm`, { action: 'pay' });
const hRow = (await q(`SELECT id, status, payment_status FROM subscriptions.holders WHERE payment_id=$1`, [sPid]))[0] ?? null;
const subTickets = hRow ? (await q(`SELECT count(*)::int n FROM subscriptions.redemptions WHERE holder_id=$1`, [hRow.id]))[0].n : 0;
const after3 = await gopayCallCount();
check('D3b', 'SUBSCRIPTION: bez auth confirm (holder seedován) → holder active/paid a vystaveny vstupenky (fixed abo), BEZ platby',
  !(sConfirm.status === 200 && hRow?.payment_status === 'paid' && hRow?.status === 'active' && subTickets >= 1 && after3 === before3),
  { confirmStatus: sConfirm.status, confirmBody: JSON.stringify(sConfirm.json ?? '').slice(0, 160), holder: hRow, ticketsIssued: subTickets, gopayCallsDelta: after3 - before3 });

// ============ D4: resale/buy — guest prevezme listing bez platby ============
// Nejdriv povolit resale na akci, pak vlastnik naliste svuj (jiny) valid ticket, pak guest koupi.
await PA.patch(`/api/admin/events/${S.eventA}/resale-policy`, { resalePolicy: 'enabled', resaleWindowHoursBefore: 0 });
const sellTicket = await buyOne(S.tt['Stani']); // druhy valid ticket pro buyer (bude prodavat)
const faceRow = (await q(`SELECT original_price FROM tickets.tickets WHERE id=$1`, [sellTicket.ticketId]))[0];
const listRes = await buyer.post('/api/buyer/resale/list', { ticketId: sellTicket.ticketId, askPriceHalire: Number(faceRow.original_price) });
const listingId = (await q(`SELECT id FROM resale.resale_listings WHERE ticket_id=$1 AND status='active' ORDER BY listed_at DESC LIMIT 1`, [sellTicket.ticketId]))[0]?.id ?? null;
const before4 = await gopayCallCount();
r = listingId ? await anon().post('/api/buyer/resale/buy', { listingId, buyerEmail: `resale-${S.run}@audit.test`, buyerName: 'Resale Buyer' }) : { status: 0, json: null };
const newTid = r.json?.newTicketId;
const newTicket = newTid ? (await q(`SELECT t.status, o.status AS order_status, o.payment_provider FROM tickets.tickets t JOIN orders.orders o ON o.id=t.order_id WHERE t.id=$1`, [newTid]))[0] : null;
const soldListing = listingId ? (await q(`SELECT status FROM resale.resale_listings WHERE id=$1`, [listingId]))[0] : null;
const after4 = await gopayCallCount();
check('D4', 'RESALE: guest (jen buyerEmail) převezme aktivní listing → nový valid lístek + paid objednávka, listing sold, BEZ platby',
  !(r.status === 200 && newTicket?.status === 'valid' && newTicket?.order_status === 'paid' && soldListing?.status === 'sold' && after4 === before4),
  { listReqStatus: listRes.status, listingId, buyStatus: r.status, newTicket, listing: soldListing, gopayCallsDelta: after4 - before4 });

// ============ D5/D6: kiosk/order (K1) + podvrzena identitni hlavicka ============
// D5: nepřihlášený POST /api/kiosk/order -> 401, žádná objednávka.
// D6: nepřihlášený POST s RUČNĚ nastaveným x-user-id (+ x-user-roles / x-promoter-id) EXISTUJÍCÍ obsluhy
//     (člen promotéra A) -> 401, žádná objednávka. Middleware musí identitní hlavičky z příchozího
//     požadavku zahodit a nastavovat je výhradně z ověřené session.
const kioskBody = (tag) => ({ promoterSlug: slug, eventId: S.eventA, ticketTypeId: S.tt['Stani'], quantity: 2, buyerEmail: `kiosk-${tag}-${S.run}-${Date.now()}@audit.test`, buyerName: 'Kiosk Utocnik' });
const kioskOrders = async (email) => (await q(`SELECT o.id, o.status FROM orders.orders o JOIN identity.users u ON u.id=o.user_id WHERE lower(u.email)=lower($1)`, [email]));
const staff = (await q(`SELECT m.user_id FROM platform.promoter_members m WHERE m.promoter_id=$1 LIMIT 1`, [S.promoterA.id]).catch(() => []))[0]?.user_id
  ?? (await q(`SELECT id FROM identity.users WHERE lower(email)=lower($1)`, [S.promoterA.email]))[0]?.id;
let kb = kioskBody('anon');
r = await anon().post('/api/kiosk/order', kb);
let ko = await kioskOrders(kb.buyerEmail);
check('D5', 'KIOSK: nepřihlášený POST /api/kiosk/order -> 401 a žádná objednávka', r.status === 401 && ko.length === 0, { ...ev(r), ordersInDb: ko });
kb = kioskBody('forged');
r = await anon().post('/api/kiosk/order', kb, { 'x-user-id': staff, 'x-user-roles': 'promoter', 'x-promoter-id': S.promoterA.id, 'x-user-email': S.promoterA.email, 'x-is-platform-admin': 'true' });
ko = await kioskOrders(kb.buyerEmail);
check('D6', 'KIOSK: nepřihlášený POST s podvrženým x-user-id existující obsluhy -> 401 a žádná objednávka', r.status === 401 && ko.length === 0, { staffUserId: staff, ...ev(r), ordersInDb: ko });

summary();
await owner.end();
