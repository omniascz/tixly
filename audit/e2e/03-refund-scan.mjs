// E2E 03: refund/storno (penize vs stav), pozdni platba po expiraci, vstup (sken) vcetne soubehu a cizi akce.
import { readFileSync, writeFileSync } from 'node:fs';
import { Client, q, owner, check, ev, startLog, summary, gopayCtl, gopayLog, gopayPayments, waitFor, sleep } from './lib.mjs';

startLog('03_refund_scan');
const S = JSON.parse(readFileSync(new URL(process.env.AUDIT_STATE ?? './state.json', import.meta.url), 'utf8'));
const login = async (name, email) => { const c = new Client(name); const r = await c.post('/api/auth/login', { email, password: S.pw }); if (r.status !== 200) throw new Error(`login ${email} ${r.status} ${r.text}`); return c; };
const buyer = await login('buyer', S.buyerEmail);
const PA = await login('promoterA', S.promoterA.email);
const PB = await login('promoterB', S.promoterB.email);

const tt = async (id) => (await q(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [id]))[0].remaining_qty;
const order = async (id) => (await q(`SELECT status, total_amount, gopay_payment_id FROM orders.orders WHERE id=$1`, [id]))[0];
const tickets = async (oid) => q(`SELECT id, status FROM tickets.tickets WHERE order_id=$1 ORDER BY id`, [oid]);
const webhook = (pid) => new Client('gopay-notify').get(`/api/payments/gopay/webhook?id=${pid}`);
const refundCalls = async (pid) => (await gopayLog()).filter((c) => c.path === `/api/payments/payment/${pid}/refund`);
async function buy(c, email, qty, ttId = S.tt['Stani'], eventId = S.eventA) {
  const r = await c.post('/api/checkout', { eventId, ticketTypeId: ttId, quantity: qty, buyerEmail: email, buyerName: 'Kupec Audit' });
  if (r.status !== 200) throw new Error(`checkout ${r.status} ${r.text}`);
  await gopayCtl(r.json.paymentId, { state: 'PAID' });
  await webhook(r.json.paymentId);
  await waitFor(async () => (await tickets(r.json.orderId)).length >= qty, 20000);
  return { orderId: r.json.orderId, pid: r.json.paymentId };
}

// ================= REFUND / STORNO =================
// R1: admin refund zaplacene objednavky
const A = await buy(buyer, S.buyerEmail, 2);
const remB = await tt(S.tt['Stani']);
let r = await PB.post(`/api/admin/orders/${A.orderId}/refund`, { reason: 'customer_request' });
check('R0', 'poradatel B refunduje objednavku poradatele A -> odmitnuto', r.status === 403 || r.status === 404, ev(r));
r = await PA.post(`/api/admin/orders/${A.orderId}/refund`, { reason: 'customer_request', note: 'audit' });
let od = await order(A.orderId); let tk = await tickets(A.orderId);
check('R1a', 'admin refund: objednavka refunded, vstupenky zneplatneny, mista vracena', r.status === 200 && od.status === 'refunded' && tk.every((t) => t.status !== 'valid') && (await tt(S.tt['Stani'])) - remB === 2, { ...ev(r), order: od, tickets: tk.map((t) => t.status), remBefore: remB, remAfter: await tt(S.tt['Stani']) });
let rc = await refundCalls(A.pid);
const gp = (await gopayPayments()).find((p) => p.id === A.pid);
check('R1b', 'PENIZE: admin refund zavolal refund u platebni brany', rc.length === 1, { refundCallsToGateway: rc.length, gatewayPaymentState: gp?.state, gatewayRefunds: gp?.refunds, note: 'DB rika refunded; brana stale PAID = zakaznik penize nedostal' });
const rr = await q(`SELECT count(*)::int n FROM orders.refund_requests WHERE order_id=$1`, [A.orderId]).catch((e) => [{ err: e.message }]);
const al = await q(`SELECT action, actor_type FROM audit.audit_log WHERE entity_id=$1 ORDER BY created_at`, [A.orderId]).catch((e) => [{ err: e.message }]);
const pev = await q(`SELECT event_type, amount FROM orders.payment_events WHERE order_id=$1 ORDER BY created_at`, [A.orderId]);
check('R1c', 'refund ma auditni stopu (audit_log / payment_events)', al.some((x) => /refund/i.test(x.action ?? '')) || pev.some((x) => /refund/i.test(x.event_type)), { audit_log: al, payment_events: pev, refund_requests: rr });
r = await PA.post(`/api/admin/orders/${A.orderId}/refund`, { reason: 'customer_request' });
check('R1d', 'opakovany refund teze objednavky odmitnut / idempotentni (mista se nevrati 2x)', (await tt(S.tt['Stani'])) - remB === 2, { ...ev(r), remAfter: await tt(S.tt['Stani']) });

// R2: buyer self-refund
const B = await buy(buyer, S.buyerEmail, 1);
r = await buyer.post(`/api/buyer/orders/${B.orderId}/refund`, { reason: 'audit self refund' });
od = await order(B.orderId);
check('R2a', 'buyer self-refund (vychozi nastaveni poradatele)', null, { ...ev(r), orderStatus: od.status, tickets: (await tickets(B.orderId)).map((t) => t.status) });
rc = await refundCalls(B.pid);
check('R2b', 'pokud self-refund probehl, zavolal branu?', od.status !== 'refunded' ? null : rc.length === 1, { orderStatus: od.status, refundCallsToGateway: rc.length });

// R3: buyer cancel zaplacene objednavky
const C = await buy(buyer, S.buyerEmail, 1);
r = await buyer.post(`/api/buyer/orders/${C.orderId}/cancel`, { reason: 'audit cancel' });
od = await order(C.orderId); tk = await tickets(C.orderId);
const rr3 = await q(`SELECT status, refunded_halire FROM orders.refund_requests WHERE order_id=$1`, [C.orderId]).catch((e) => [{ err: e.message }]);
check('R3a', 'buyer storno zaplacene objednavky: odpoved vs skutecny stav v DB (tichy refund?)', r.status !== 200 ? null : (od.status === 'cancelled' && tk.every((t) => t.status !== 'valid')), { ...ev(r), orderStatusInDb: od.status, tickets: tk.map((t) => t.status), refund_requests: rr3 });
check('R3b', 'storno zaplacene objednavky zanechalo zaznam o naroku na vraceni penez (refund_request) nebo volani brany', r.status !== 200 ? null : (rr3.length > 0 && !rr3[0].err) || (await refundCalls(C.pid)).length > 0, { refund_requests: rr3, gatewayRefundCalls: (await refundCalls(C.pid)).length });

// R4: cizi kupec
const other = await login('other', S.otherEmail);
const D = await buy(buyer, S.buyerEmail, 1);
r = await other.post(`/api/buyer/orders/${D.orderId}/cancel`, { reason: 'x' });
const r2 = await other.post(`/api/buyer/orders/${D.orderId}/refund`, { reason: 'x' });
check('R4', 'CIZI kupec nemuze stornovat/refundovat cizi objednavku (IDOR)', [403, 404].includes(r.status) && [403, 404].includes(r2.status) && (await order(D.orderId)).status === 'paid', { cancel: ev(r), refund: ev(r2), status: (await order(D.orderId)).status });

// R5: refund hlaseny branou (webhook REFUNDED) -> vstupenky?
await gopayCtl(D.pid, { state: 'REFUNDED' });
r = await webhook(D.pid); await sleep(1000);
od = await order(D.orderId); tk = await tickets(D.orderId);
check('R5', 'brana ohlasi REFUNDED (refund z portalu brany / chargeback): objednavka refunded A vstupenky zneplatneny', od.status === 'refunded' && tk.every((t) => t.status !== 'valid'), { ...ev(r), orderStatus: od.status, tickets: tk.map((t) => t.status), note: 'pokud tickets=valid: zakaznik ma penize zpet i platnou vstupenku' });

// R6: pozdni platba na EXPIROVANOU objednavku (cron je rozbity -> stav nastaven SQL jako by cron fungoval)
r = await buyer.post('/api/checkout', { eventId: S.eventA, ticketTypeId: S.tt['Stani'], quantity: 1, buyerEmail: S.buyerEmail, buyerName: 'Kupec Audit' });
const E = { orderId: r.json.orderId, pid: r.json.paymentId };
await q(`UPDATE orders.orders SET status='expired' WHERE id=$1`, [E.orderId]);
await gopayCtl(E.pid, { state: 'PAID' });
r = await webhook(E.pid); await sleep(2500);
od = await order(E.orderId); tk = await tickets(E.orderId);
const pev6 = await q(`SELECT event_type, gopay_status FROM orders.payment_events WHERE order_id=$1`, [E.orderId]);
check('R6', 'zaplaceno po expiraci: zakaznik zaplatil, objednavka expired -> existuje mechanismus (auto-refund / fronta k reseni)?', (await refundCalls(E.pid)).length > 0 || od.status === 'paid', { ...ev(r), orderStatus: od.status, tickets: tk.length, payment_events: pev6, gatewayRefundCalls: (await refundCalls(E.pid)).length });

// ================= VSTUP (SKEN) =================
const G = await buy(buyer, S.buyerEmail, 3);
const gt = await tickets(G.orderId);
const scan = (c, body) => c.post('/api/admin/scanner/validate', body);
const qr = (await q(`SELECT qr_policy FROM catalog.events WHERE id=$1`, [S.eventA]))[0].qr_policy;
check('V0', 'vychozi QR politika akce', null, { qr_policy: qr });

r = await scan(buyer, { ticketId: gt[0].id });
check('V1', 'zakaznik (ne-poradatel) nemuze volat skener', [401, 403].includes(r.status), ev(r));
r = await scan(PB, { ticketId: gt[0].id });
const st1 = (await q(`SELECT status FROM tickets.tickets WHERE id=$1`, [gt[0].id]))[0].status;
check('V2', 'skener CIZIHO poradatele vstupenku odmitne a neoznaci ji jako pouzitou', r.json?.result !== 'admitted' && st1 === 'valid', { ...ev(r), ticketStatus: st1 });
r = await scan(PA, { ticketId: gt[0].id, deviceId: 'audit-gate-1' });
const st2 = (await q(`SELECT status, used_at FROM tickets.tickets WHERE id=$1`, [gt[0].id]))[0];
check('V3', 'platna vstupenka -> admitted, stav used', r.status === 200 && r.json?.result === 'admitted' && st2.status === 'used', { ...ev(r), ticket: st2 });
r = await scan(PA, { ticketId: gt[0].id, deviceId: 'audit-gate-1' });
check('V4', 'dvojity sken -> already_used (ne admitted)', r.json?.result === 'already_used', ev(r));
r = await scan(PA, { ticketId: '00000000-0000-4000-8000-000000000000' });
check('V5', 'neexistujici vstupenka -> not_found', r.json?.result === 'not_found', ev(r));
r = await scan(PA, { ticketId: gt[1].id, totpCode: '000000' });
const st3 = (await q(`SELECT status FROM tickets.tickets WHERE id=$1`, [gt[1].id]))[0].status;
check('V6', 'spatny TOTP kod -> totp_mismatch, vstupenka zustava valid', r.json?.result === 'totp_mismatch' && st3 === 'valid', { ...ev(r), ticketStatus: st3 });

// soubeh: 20 paralelnich skenu jedne vstupenky
const race = await Promise.all(Array.from({ length: 20 }, () => scan(PA, { ticketId: gt[1].id, deviceId: 'race' })));
const admitted = race.filter((x) => x.json?.result === 'admitted').length;
const hist = {}; for (const x of race) { const k = `${x.status}:${x.json?.result ?? x.json?.error}`; hist[k] = (hist[k] ?? 0) + 1; }
check('V7', '20 soubeznych skenu jedne vstupenky -> prave 1x admitted', admitted === 1, hist);

// stornovana vstupenka
const tkA = await tickets(A.orderId);
r = await scan(PA, { ticketId: tkA[0].id });
check('V8', 'sken vstupenky z REFUNDOVANE objednavky -> odmitnuto', r.json?.result !== 'admitted', ev(r));

// cizi akce tehoz poradatele
const in5 = new Date(Date.now() + 5 * 864e5).toISOString();
r = await PA.post('/api/admin/events', { title: `Audit Koncert A2 ${S.run}`, description: 'Druha akce tehoz poradatele.', category: 'music', dateStart: in5, venueId: S.venueId, currency: 'CZK', ticketTypes: [{ name: 'A2 stani', priceHalire: 10000, capacity: 10 }] });
S.eventA2 = r.json?.eventId;
const man = await PA.get(`/api/admin/scanner/manifest?eventId=${S.eventA2}`);
check('V9a', 'offline manifest akce A2 neobsahuje vstupenky akce A', man.status === 200 && !JSON.stringify(man.json).includes(gt[2].id), { status: man.status, body: JSON.stringify(man.json).slice(0, 200) });
r = await scan(PA, { ticketId: gt[2].id, deviceId: 'gate-of-event-A2' });
const st4 = (await q(`SELECT status FROM tickets.tickets WHERE id=$1`, [gt[2].id]))[0].status;
check('V9b', 'SKEN CIZI AKCE: vstupenka akce A u brany akce A2 (tyz poradatel) — API neumi rict, kterou akci brana obsluhuje', r.json?.result !== 'admitted', { ...ev(r), ticketStatus: st4, note: 'schema /api/admin/scanner/validate nema eventId; online sken vpusti vstupenku jakekoli akce poradatele' });

const manA = await PA.get(`/api/admin/scanner/manifest?eventId=${S.eventA}`);
const ids = JSON.stringify(manA.json);
check('V10', 'offline manifest akce A: jen platne vstupenky (neobsahuje pouzitou gt[0] ani refundovanou)', manA.status === 200 && !ids.includes(gt[0].id) && !ids.includes(tkA[0].id), { status: manA.status, count: manA.json?.ticketIds?.length ?? manA.json?.count, keys: Object.keys(manA.json ?? {}) });
r = await PB.get(`/api/admin/scanner/manifest?eventId=${S.eventA}`);
check('V11', 'poradatel B nestahne manifest akce A', r.status === 404 || r.status === 403, ev(r));
const logs = await q(`SELECT result, count(*)::int n FROM tickets.scan_logs WHERE ticket_id = ANY($1::uuid[]) GROUP BY 1 ORDER BY 1`, [gt.map((t) => t.id)]).catch((e) => [{ err: e.message }]);
check('V12', 'skeny jsou zaznamenany ve scan_logs', logs.length > 0 && !logs[0].err, logs);

writeFileSync(new URL(process.env.AUDIT_STATE ?? './state.json', import.meta.url), JSON.stringify(S, null, 2));
summary();
await owner.end();
