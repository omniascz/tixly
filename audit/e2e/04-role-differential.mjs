// E2E 04: ROZDILOVY test — stejne kroky proti instanci pod `tixly_app` (RLS plati; port 3100)
// a pod `neondb_owner` (BYPASSRLS = dnesni produkcni role dle GO-LIVE-CHECKLIST; port 3101).
// Odlisi "rozbite jen pod RLS" od "rozbite vzdy".
// Pouziti: AUDIT_BASE=http://localhost:3100 node audit/e2e/04-role-differential.mjs app
//          AUDIT_BASE=http://localhost:3101 node audit/e2e/04-role-differential.mjs owner
import { readFileSync } from 'node:fs';
import { Client, q, owner, check, ev, startLog, summary, gopayCtl, waitFor, sleep, INTERNAL_TOKEN, BASE, scenarioBuyer } from './lib.mjs';

const label = process.argv[2] ?? 'app';
startLog(`04_differential_${label}`);
const S = JSON.parse(readFileSync(new URL(process.env.AUDIT_STATE ?? './state.json', import.meta.url), 'utf8'));
const login = async (name, email) => { const c = new Client(name); const r = await c.post('/api/auth/login', { email, password: S.pw }); if (r.status !== 200) throw new Error(`login ${email} ${r.status} ${r.text}`); return c; };
// kolo 2: vlastni kupec na scenar (per-e-mail/per-IP limit checkoutu z K3)
const sX = await scenarioBuyer(S, `X-${label}-${Date.now().toString(36)}`);
const buyer = sX.c;
const PA = await login('promoterA', S.promoterA.email);
const tickets = async (oid) => q(`SELECT id, status FROM tickets.tickets WHERE order_id=$1`, [oid]);
const order = async (id) => (await q(`SELECT status FROM orders.orders WHERE id=$1`, [id]))[0];
const webhook = (pid) => new Client('gopay-notify').get(`/api/payments/gopay/webhook?id=${pid}`);
async function buy(qty) {
  const r = await buyer.post('/api/checkout', { eventId: S.eventA, ticketTypeId: S.tt['Stani'], quantity: qty, buyerEmail: sX.email, buyerName: 'Kupec Audit' });
  if (r.status !== 200) return { err: ev(r) };
  await gopayCtl(r.json.paymentId, { state: 'PAID' }); await webhook(r.json.paymentId);
  await waitFor(async () => (await tickets(r.json.orderId)).length >= qty, 20000);
  return { orderId: r.json.orderId, pid: r.json.paymentId };
}

const A = await buy(1);
check('X1', `[${label}] checkout + platba + vystaveni`, !A.err && (await tickets(A.orderId)).length === 1, A.err ?? { tickets: (await tickets(A.orderId)).length });

let r = await buyer.get(`/api/buyer/orders/${A.orderId}/ticket-pdf`);
check('X2', `[${label}] vlastnik stahne PDF vstupenek`, r.status === 200 && r.text.startsWith('%PDF'), { status: r.status, ct: r.headers.get('content-type'), bytes: r.text.length, head: r.text.slice(0, 60) });

r = await buyer.post(`/api/buyer/orders/${A.orderId}/cancel`, { reason: 'audit' });
const od = await order(A.orderId); const tk = await tickets(A.orderId);
const rr = await q(`SELECT status, refunded_halire, user_id IS NOT NULL AS has_user FROM orders.refund_requests WHERE order_id=$1`, [A.orderId]);
check('X3', `[${label}] buyer storno zaplacene objednavky: odpoved 200 <=> DB cancelled + vstupenky neplatne + refund_request`, r.status === 200 && od.status === 'cancelled' && tk.every((t) => t.status !== 'valid') && rr.length === 1, { ...ev(r), orderStatusInDb: od.status, tickets: tk.map((t) => t.status), refund_requests: rr });

r = await new Client('cron').post('/api/internal/cron/expire-pending-orders', {}, { 'x-internal-token': INTERNAL_TOKEN });
check('X4', `[${label}] cron expire-pending-orders`, r.status === 200, ev(r));
r = await new Client('cron').post('/api/internal/cron/release-expired-seat-holds', {}, { 'x-internal-token': INTERNAL_TOKEN });
check('X5', `[${label}] cron release-expired-seat-holds`, r.status === 200, ev(r));

// kolo 3 (X6): GET /api/buyer/orders zadna stranka ani komponenta nevola (grep src/, mobile/,
// mobile-promoter/) — webovy seznam kupce („Moje vstupenky") stoji na GET /api/buyer/my-tickets
// (vstupenky vc. order_id). Kontrola proto miri na skutecne pouzivany endpoint: vlastni objednavka
// A je v seznamu. (Mobilni appka vola /api/v1/buyer/orders, ktery neexistuje — FIX_REPORT_R3.)
r = await buyer.get('/api/buyer/my-tickets');
check('X6', `[${label}] kupec vidi seznam svych vstupenek/objednavek (GET /api/buyer/my-tickets)`, r.status === 200 && Array.isArray(r.json?.tickets) && r.json.tickets.some((t) => t.order_id === A.orderId), { status: r.status, count: r.json?.tickets?.length, body: (r.text ?? '').slice(0, 160) });
// kolo 2: X7 na VLASTNÍ zaplacené objednávce — A je po X3 stornovaná (storno pod tixly_app
// dřív padalo, proto X7 „náhodou" běžel na zaplacené objednávce).
const A7 = await buy(1);
r = await buyer.get(`/api/buyer/orders/${A7.orderId}/invoice`);
check('X7', `[${label}] doklad/faktura k objednavce (kupec)`, r.status === 200, { status: r.status, ct: r.headers.get('content-type'), head: r.text.slice(0, 120) });
r = await PA.get('/api/admin/orders');
check('X8', `[${label}] poradatel: seznam objednavek`, r.status === 200 && JSON.stringify(r.json).includes(A.orderId), { status: r.status, body: (r.text ?? '').slice(0, 160) });
r = await PA.get('/api/admin/orders/export');
check('X9', `[${label}] poradatel: export objednavek`, r.status === 200 && r.text.length > 50, { status: r.status, ct: r.headers.get('content-type'), head: r.text.slice(0, 160) });
r = await PA.get(`/api/admin/events/${S.eventA}/sales-report`);
check('X10', `[${label}] poradatel: sales report akce`, r.status === 200, { status: r.status, body: (r.text ?? '').slice(0, 300) });
r = await PA.get('/api/admin/invoices');
check('X11', `[${label}] poradatel: faktury`, r.status === 200, { status: r.status, body: (r.text ?? '').slice(0, 200) });
r = await PA.get('/api/admin/payouts');
check('X12', `[${label}] poradatel: vyplaty`, r.status === 200, { status: r.status, body: (r.text ?? '').slice(0, 200) });
r = await PA.get(`/api/admin/scanner/export?eventId=${S.eventA}`);
check('X13', `[${label}] poradatel: export skenu`, r.status === 200, { status: r.status, head: (r.text ?? '').slice(0, 160) });
r = await new Client('fp').post('/api/auth/forgot-password', { email: S.buyerEmail });
check('X14', `[${label}] zapomenute heslo`, r.status === 200, ev(r));

summary();
await owner.end();
