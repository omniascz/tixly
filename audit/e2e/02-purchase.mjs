// E2E 02: nakup — kosik, rezervace, platba (simulovany GoPay + skutecny webhook handler), vystaveni,
// e-mail, idempotence webhooku, podplaceni, vyprodani, limity, promo, expirace rezervace.
import { readFileSync, writeFileSync } from 'node:fs';
import { Client, q, owner, check, ev, startLog, summary, gopayCtl, gopayPayments, gopayLog, mails, waitFor, sleep, INTERNAL_TOKEN, BASE } from './lib.mjs';

startLog('02_purchase');
const S = JSON.parse(readFileSync(new URL(process.env.AUDIT_STATE ?? './state.json', import.meta.url), 'utf8'));
const login = async (name, email) => { const c = new Client(name); const r = await c.post('/api/auth/login', { email, password: S.pw }); if (r.status !== 200) throw new Error(`login ${email} ${r.status} ${r.text}`); return c; };
const admin = await login('padmin', S.adminEmail);
const buyer = await login('buyer', S.buyerEmail);

const tt = async (id) => (await q(`SELECT remaining_qty, total_qty FROM catalog.ticket_types WHERE id=$1`, [id]))[0];
const order = async (id) => (await q(`SELECT id, status, total_amount, currency, gopay_payment_id, user_id, expires_at, paid_at FROM orders.orders WHERE id=$1`, [id]))[0];
const tickets = async (oid) => q(`SELECT id, status, ticket_type_id, owner_id FROM tickets.tickets WHERE order_id=$1`, [oid]);
const webhook = (pid) => new Client('gopay-notify').get(`/api/payments/gopay/webhook?id=${pid}`);
const co = (c, body) => c.post('/api/checkout', { eventId: S.eventA, quantity: 1, buyerEmail: S.buyerEmail, buyerName: 'Kupec Audit', ...body });

// ---------- P0 publikace ----------
for (const [k, id] of [['A', S.eventA], ['B', S.eventB]]) {
  const r = await admin.post(`/api/platform/moderation/${id}/approve`);
  const st = (await q(`SELECT status FROM catalog.events WHERE id=$1`, [id]))[0].status;
  check(`P0${k}`, `schvaleni akce ${k} moderaci -> published`, r.status === 200 && st === 'published', { ...ev(r), dbStatus: st });
}
let r = await new Client('pub').get(`/api/events/${S.eventA}/ticket-types`);
check('P0c', 'verejny vypis typu vstupenek publikovane akce', r.status === 200 && JSON.stringify(r.json).includes(S.tt['Stani']), ev(r));

// ---------- P1 kosik ----------
r = await buyer.post('/api/cart/validate', { eventId: S.eventA, items: [{ ticketTypeId: S.tt['Stani'], quantity: 2 }] });
check('P1', 'validace kosiku (/api/cart/validate)', r.status === 200, ev(r));

// ---------- P2 checkout s promo kodem ----------
const before = await tt(S.tt['Stani']);
r = await co(buyer, { ticketTypeId: S.tt['Stani'], quantity: 2, promoCode: S.promo });
const o1 = r.json?.orderId; const pid1 = r.json?.paymentId;
check('P2a', 'checkout 2x Stani s promo 20 % -> objednavka + platebni relace', r.status === 200 && !!o1 && !!pid1, ev(r));
let od = await order(o1);
check('P2b', 'cena spoctena serverem: 2*500 Kc -20 % = 800 Kc (80000 hal)', od?.total_amount === 80000, { total_amount: od?.total_amount, status: od?.status, response: { subtotal: r.json?.subtotalAmount, discount: r.json?.discountAmount, total: r.json?.totalAmount } });
const after = await tt(S.tt['Stani']);
check('P2c', 'rezervace: remaining_qty 50 -> 48, objednavka pending s expiraci', before.remaining_qty - after.remaining_qty === 2 && od.status === 'pending' && new Date(od.expires_at) > new Date(), { before, after, expires_at: od.expires_at });
const gp = (await gopayPayments()).find((p) => p.id === pid1);
check('P2d', 'brana dostala spravnou castku a notification_url', gp?.amount === 80000 && gp?.currency === 'CZK', gp);
check('P2e', 'pred platbou neexistuje zadna vstupenka', (await tickets(o1)).length === 0, { tickets: (await tickets(o1)).length });

// ---------- P3 manipulace s cenou ----------
r = await co(buyer, { ticketTypeId: S.tt['Stani'], quantity: 1, expectedUnitPriceHalire: 1 });
check('P3', 'klientem podvrzena cena (1 hal) odmitnuta', r.status >= 400 && r.status < 500, ev(r));
r = await co(buyer, { ticketTypeId: S.tt['Stani'], quantity: -1 });
check('P3b', 'zaporne mnozstvi odmitnuto (422)', r.status === 422, ev(r));
r = await co(buyer, { ticketTypeId: S.ttB, quantity: 1 });
check('P3c', 'typ vstupenky z JINE akce (B) pod eventId A odmitnut', r.status >= 400 && r.status < 500, ev(r));

// ---------- P4 webhook pred zaplacenim ----------
r = await webhook(pid1);
od = await order(o1);
check('P4', 'webhook pri stavu CREATED: objednavka zustava pending, zadne vstupenky', od.status === 'pending' && (await tickets(o1)).length === 0, { ...ev(r), status: od.status });

// ---------- P5 zaplaceni + webhook 3x (idempotence) ----------
await gopayCtl(pid1, { state: 'PAID' });
const w = [];
for (let i = 0; i < 3; i++) w.push(await webhook(pid1));
od = await order(o1);
check('P5a', 'po webhooku PAID je objednavka paid', od.status === 'paid' && !!od.paid_at, { webhookStatuses: w.map((x) => x.status), order: od });
const tk = await waitFor(async () => { const t = await tickets(o1); return t.length >= 2 ? t : null; }, 20000);
check('P5b', 'vystaveny presne 2 vstupenky (3x stejny webhook)', tk?.length === 2, { tickets: tk ?? (await tickets(o1)) });
await sleep(3000);
const tk2 = await tickets(o1);
const pe = await q(`SELECT event_type, count(*)::int n FROM orders.payment_events WHERE order_id=$1 GROUP BY 1 ORDER BY 1`, [o1]);
check('P5c', 'idempotence: i po 3 webhookech porad 2 vstupenky', tk2.length === 2, { tickets: tk2.length });
check('P5d', 'zaznam platby: kolik udalosti payment_paid vzniklo pro 1 platbu (ocekavano 1)', pe.find((x) => x.event_type === 'payment_paid')?.n === 1, pe);

// soubezne 3x webhook na novou objednavku
r = await co(buyer, { ticketTypeId: S.tt['Stani'], quantity: 3 });
const o2 = r.json?.orderId, pid2 = r.json?.paymentId;
await gopayCtl(pid2, { state: 'PAID' });
const par = await Promise.all([webhook(pid2), webhook(pid2), webhook(pid2)]);
await waitFor(async () => (await tickets(o2)).length >= 3, 20000); await sleep(3000);
const t2 = await tickets(o2);
check('P5e', '3 SOUBEZNE webhooky na 1 platbu -> presne 3 vstupenky (qty 3), zadne dvojite vystaveni', t2.length === 3, { webhookStatuses: par.map((x) => x.status), tickets: t2.length });

// ---------- P6 e-mail ----------
const ms = await waitFor(async () => { const m = await mails(`to:${S.buyerEmail}`); return m.length ? m : null; }, 20000);
check('P6', 'e-mail se vstupenkami dorucen (zachycen v Mailpit)', (ms?.length ?? 0) > 0, (ms ?? []).slice(0, 6).map((m) => ({ subject: m.Subject, attachments: m.Attachments, to: m.To?.map((t) => t.Address) })));
const mailsO1 = (ms ?? []).length;
check('P6b', 'pocet e-mailu po 2 objednavkach a 6 webhookech (ocekavano 2 potvrzeni)', null, { count: mailsO1, subjects: (ms ?? []).map((m) => m.Subject) });

// ---------- P7 kod vstupenky / TOTP ----------
r = await buyer.get(`/api/buyer/tickets/${tk2[0].id}/totp`);
check('P7a', 'kupec ziska rotujici kod (TOTP) sve vstupenky', r.status === 200, ev(r));
const other = new Client('other'); await other.post('/api/auth/register', { email: `other-${S.run}@audit.test`, password: S.pw, name: 'Jiny Kupec' });
S.otherEmail = `other-${S.run}@audit.test`;
r = await other.get(`/api/buyer/tickets/${tk2[0].id}/totp`);
check('P7b', 'CIZI kupec kod cizi vstupenky nedostane (IDOR)', r.status === 403 || r.status === 404, ev(r));
r = await other.get(`/api/buyer/orders/${o1}/ticket-pdf`);
check('P7c', 'CIZI kupec nestahne PDF cizi objednavky (IDOR)', r.status === 403 || r.status === 404 || r.status === 401, { status: r.status, len: r.text.length });
r = await buyer.get(`/api/buyer/orders/${o1}/ticket-pdf`);
check('P7d', 'vlastnik stahne PDF vstupenek', r.status === 200 && r.text.startsWith('%PDF'), { status: r.status, contentType: r.headers.get('content-type'), bytes: r.text.length });

// ---------- P8 podplaceni ----------
r = await co(buyer, { ticketTypeId: S.tt['Stani'], quantity: 1 });
const o3 = r.json?.orderId, pid3 = r.json?.paymentId;
await gopayCtl(pid3, { state: 'PAID', amount: 100 });
r = await webhook(pid3); await sleep(1500);
od = await order(o3);
check('P8', 'podplaceni (brana hlasi 1 Kc misto 500 Kc) -> objednavka NENI paid, zadna vstupenka', od.status === 'pending' && (await tickets(o3)).length === 0, { ...ev(r), status: od.status });

// ---------- P9 order-completed primo ----------
r = await new Client('x').post('/api/internal/order-completed', { orderId: o3 });
check('P9a', 'interni order-completed bez tokenu odmitnut', r.status === 401 || r.status === 403, ev(r));
r = await new Client('x').post('/api/internal/order-completed', { orderId: o3 }, { 'x-internal-token': INTERNAL_TOKEN });
await sleep(1500);
check('P9b', 'order-completed na NEZAPLACENOU objednavku nevystavi vstupenky', (await tickets(o3)).length === 0, { ...ev(r), tickets: (await tickets(o3)).length });

// ---------- P10 guest checkout ----------
const guest = new Client('guest');
const gEmail = `guest-${S.run}@audit.test`;
r = await guest.post('/api/checkout', { eventId: S.eventA, ticketTypeId: S.tt['Stani'], quantity: 1, buyerEmail: gEmail, buyerName: 'Host Bez Uctu' });
const o4 = r.json?.orderId, pid4 = r.json?.paymentId;
check('P10a', 'guest checkout (bez prihlaseni)', r.status === 200 && !!o4, ev(r));
if (pid4) { await gopayCtl(pid4, { state: 'PAID' }); await webhook(pid4); }
const t4 = await waitFor(async () => { const t = await tickets(o4); return t.length ? t : null; }, 20000);
const gm = await waitFor(async () => { const m = await mails(`to:${gEmail}`); return m.length ? m : null; }, 15000);
check('P10b', 'guest: vstupenka vystavena + e-mail dorucen', t4?.length === 1 && (gm?.length ?? 0) > 0, { tickets: t4?.length, mails: (gm ?? []).map((m) => m.Subject) });
S.guestEmail = gEmail; S.guestOrder = o4;

// ---------- P11 vyprodani (Posledni mista, kapacita 5) ----------
const L = S.tt['Posledni mista'];
const a = await co(buyer, { ticketTypeId: L, quantity: 3 });
const b = await co(buyer, { ticketTypeId: L, quantity: 3 });
const c = await co(buyer, { ticketTypeId: L, quantity: 2 });
const d = await co(buyer, { ticketTypeId: L, quantity: 1 });
const rem = await tt(L);
check('P11', 'vyprodani: 3 OK, dalsi 3 odmitnuty, 2 OK, 1 odmitnut; remaining_qty = 0', a.status === 200 && b.status >= 400 && c.status === 200 && d.status >= 400 && rem.remaining_qty === 0, { a: a.status, b: ev(b), c: c.status, d: ev(d), remaining: rem });
S.lastSeatsOrders = [a.json?.orderId, c.json?.orderId];

// ---------- P12 limit na osobu ----------
const M = S.tt['Limit 2 na osobu'];
const m1 = await co(buyer, { ticketTypeId: M, quantity: 2 });
const m2 = await co(buyer, { ticketTypeId: M, quantity: 1 });
check('P12', 'limit 2 ks/osobu: 2 OK, treti kus odmitnut', m1.status === 200 && m2.status >= 400 && m2.status < 500, { first: ev(m1), second: ev(m2) });
const m3 = await co(buyer, { ticketTypeId: M, quantity: 3 });
check('P12b', 'limit 2 ks/osobu: 3 ks naraz odmitnuto', m3.status >= 400 && m3.status < 500, ev(m3));

// ---------- P13 vstupenka zdarma ----------
r = await co(buyer, { ticketTypeId: S.tt['Zdarma'], quantity: 1 });
const o5 = r.json?.orderId;
await sleep(4000);
od = o5 ? await order(o5) : null;
check('P13', 'vstupenka zdarma (0 Kc): objednavka dokoncena a vstupenka vystavena bez platby', r.status === 200 && od?.status === 'paid' && (await tickets(o5)).length === 1, { ...ev(r), order: od, tickets: o5 ? (await tickets(o5)).length : 0 });

// ---------- P14 promo: max 3 pouziti ----------
const pr = [];
for (let i = 0; i < 3; i++) { const x = await co(buyer, { ticketTypeId: S.tt['Stani'], quantity: 1, promoCode: S.promo }); pr.push({ status: x.status, applied: x.json?.promoCodeApplied, total: x.json?.totalAmount, err: x.json?.error }); }
const uses = (await q(`SELECT uses_count, max_uses FROM marketing.promo_codes WHERE upper(code)=$1`, [S.promo]))[0];
check('P14', 'promo kod max 3 pouziti: 1 (P2) + 2 dalsi OK, pak odmitnut/neaplikovan; uses_count <= 3', uses.uses_count <= 3 && pr[2].applied !== true, { attempts: pr, db: uses });

// ---------- P15 expirace rezervace ----------
r = await co(buyer, { ticketTypeId: S.tt['Stani'], quantity: 4 });
const o6 = r.json?.orderId, pid6 = r.json?.paymentId;
const remBefore = await tt(S.tt['Stani']);
await q(`UPDATE orders.orders SET expires_at = NOW() - INTERVAL '1 minute' WHERE id=$1`, [o6]);
r = await new Client('cron').post('/api/internal/cron/expire-pending-orders', {}, { 'x-internal-token': INTERNAL_TOKEN });
od = await order(o6);
const remAfter = await tt(S.tt['Stani']);
check('P15a', 'cron expirace: prosla pending objednavka -> expired a 4 mista vracena do prodeje', od.status === 'expired' && remAfter.remaining_qty - remBefore.remaining_qty === 4, { cron: ev(r), status: od.status, remBefore, remAfter });
// pozdni platba na expirovanou objednavku
await gopayCtl(pid6, { state: 'PAID' });
r = await webhook(pid6); await sleep(3000);
od = await order(o6);
const t6 = await tickets(o6);
const remLate = await tt(S.tt['Stani']);
check('P15b', 'POZDNI PLATBA na expirovanou objednavku: penize prijaty branou — co udela system?', null, { webhook: ev(r), orderStatus: od.status, tickets: t6.length, remaining_qty: remLate.remaining_qty, note: 'zakaznik zaplatil; pokud status=expired a tickets=0 a neni refund/zaznam k reseni, penize visi' });
const late = await q(`SELECT event_type, gopay_status FROM orders.payment_events WHERE order_id=$1`, [o6]);
check('P15c', 'pozdni platba je aspon zaznamenana v payment_events', late.some((x) => x.gopay_status === 'PAID'), late);

// ---------- P16 kapacita se nikdy neprekroci (soucet) ----------
const inv = await q(`SELECT tt.name, tt.total_qty, tt.remaining_qty,
   (SELECT COALESCE(SUM(oi.quantity),0)::int FROM orders.order_items oi JOIN orders.orders o ON o.id=oi.order_id WHERE oi.ticket_type_id=tt.id AND o.status IN ('pending','paid')) AS held_or_sold,
   (SELECT count(*)::int FROM tickets.tickets t WHERE t.ticket_type_id=tt.id AND t.status IN ('valid','used')) AS issued
   FROM catalog.ticket_types tt WHERE tt.event_id=$1 ORDER BY tt.name`, [S.eventA]);
check('P16', 'invariant: total_qty = remaining_qty + (pending+paid kusy) a issued <= total_qty pro kazdy typ', inv.every((x) => x.total_qty === x.remaining_qty + x.held_or_sold && x.issued <= x.total_qty), inv);

S.orders = { o1, o2, o3, o4, o5, o6 }; S.pids = { pid1, pid2, pid3, pid4, pid6 };
writeFileSync(new URL(process.env.AUDIT_STATE ?? './state.json', import.meta.url), JSON.stringify(S, null, 2));
summary();
await owner.end();
