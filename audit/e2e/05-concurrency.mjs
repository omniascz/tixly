// E2E 05: SOUBEH — 100 paralelnich nakupu poslednich 10 mist, soubezne webhooky + order-completed,
// zavod na promo kodu (max_uses) a na limitu na osobu. Ground truth z DB.
import { readFileSync } from 'node:fs';
import { Client, q, owner, check, ev, startLog, summary, gopayCtl, sleep, INTERNAL_TOKEN, scenarioBuyer } from './lib.mjs';

startLog('05_concurrency');
const S = JSON.parse(readFileSync(new URL(process.env.AUDIT_STATE ?? './state.json', import.meta.url), 'utf8'));
const login = async (name, email) => { const c = new Client(name); const r = await c.post('/api/auth/login', { email, password: S.pw }); if (r.status !== 200) throw new Error(`login ${email} ${r.status} ${r.text}`); return c; };
const PA = await login('promoterA', S.promoterA.email);
const hist = (arr, f) => { const h = {}; for (const x of arr) { const k = f(x); h[k] = (h[k] ?? 0) + 1; } return h; };
const key = (x) => `${x.status}:${x.json?.error ?? (x.json?.orderId ? 'OK' : (x.text ?? '').slice(0, 40))}`;
const webhook = (pid) => new Client('gopay-notify').get(`/api/payments/gopay/webhook?id=${pid}`);

async function mkType(name, qty, extra = {}) {
  const r = await PA.post(`/api/admin/events/${S.eventA}/ticket-types`, { name, priceHalire: 10000, totalQty: qty, ...extra });
  const id = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1 AND name=$2`, [S.eventA, name]))[0]?.id;
  if (!id) throw new Error(`mkType ${name}: ${r.status} ${r.text}`);
  return id;
}
const ttRow = async (id) => (await q(`SELECT total_qty, remaining_qty FROM catalog.ticket_types WHERE id=$1`, [id]))[0];

// ---------- C1: 100 paralelnich nakupu, 10 mist ----------
const N = 100, CAP = 10;
const race = await mkType(`Race ${Date.now()}`, CAP);
const t0 = Date.now();
const res = await Promise.all(Array.from({ length: N }, (_, i) => {
  const c = new Client(`g${i}`);
  return c.post('/api/checkout', { eventId: S.eventA, ticketTypeId: race, quantity: 1, buyerEmail: `race-${S.run}-${Date.now()}-${i}@audit.test`, buyerName: `Zavodnik ${i}` });
}));
const ms = Date.now() - t0;
const ok = res.filter((x) => x.status === 200 && x.json?.orderId);
const row = await ttRow(race);
const dbOrders = await q(`SELECT o.status, count(*)::int n, sum(oi.quantity)::int qty FROM orders.orders o JOIN orders.order_items oi ON oi.order_id=o.id WHERE oi.ticket_type_id=$1 GROUP BY 1`, [race]);
const held = dbOrders.reduce((a, b) => a + b.qty, 0);
check('C1a', `${N} soubeznych nakupu na ${CAP} mist: uspelo prave ${CAP}, zadny preprodej`, ok.length === CAP && held === CAP && row.remaining_qty === 0, { ms, responses: hist(res, key), remaining_qty: row.remaining_qty, dbOrders });
check('C1b', 'remaining_qty nikdy zaporne; neuspesne pozadavky dostaly cistou odpoved (409), ne 500', row.remaining_qty >= 0 && res.filter((x) => x.status >= 500).length === 0, { http5xx: res.filter((x) => x.status >= 500).length, sample5xx: res.filter((x) => x.status >= 500).slice(0, 2).map(ev) });

// ---------- C2: zaplatit vsech 10, kazdy 3 soubezne webhooky + 2 prime order-completed ----------
await Promise.all(ok.map((x) => gopayCtl(x.json.paymentId, { state: 'PAID' })));
const hooks = await Promise.all(ok.flatMap((x) => [webhook(x.json.paymentId), webhook(x.json.paymentId), webhook(x.json.paymentId),
  new Client('oc').post('/api/internal/order-completed', { orderId: x.json.orderId }, { 'x-internal-token': INTERNAL_TOKEN }),
  new Client('oc').post('/api/internal/order-completed', { orderId: x.json.orderId }, { 'x-internal-token': INTERNAL_TOKEN })]));
await sleep(12000);
const issued = await q(`SELECT t.order_id, count(*)::int n FROM tickets.tickets t WHERE t.ticket_type_id=$1 GROUP BY 1`, [race]);
const total = issued.reduce((a, b) => a + b.n, 0);
const paid = (await q(`SELECT count(*)::int n FROM orders.orders o JOIN orders.order_items oi ON oi.order_id=o.id WHERE oi.ticket_type_id=$1 AND o.status='paid'`, [race]))[0].n;
check('C2a', `50 soubeznych volani (30 webhooku + 20 order-completed) na 10 objednavek: prave ${CAP} vstupenek, 1 na objednavku`, total === CAP && issued.every((x) => x.n === 1) && paid === CAP, { hookStatuses: hist(hooks, (x) => String(x.status)), paidOrders: paid, ticketsTotal: total, maxPerOrder: Math.max(0, ...issued.map((x) => x.n)) });
const pp = await q(`SELECT pe.order_id, count(*)::int n FROM orders.payment_events pe JOIN orders.order_items oi ON oi.order_id=pe.order_id WHERE oi.ticket_type_id=$1 AND pe.event_type='payment_paid' GROUP BY 1`, [race]);
check('C2b', 'jedna platba = jeden zaznam payment_paid (3 webhooky na platbu)', pp.every((x) => x.n === 1), { payment_paid_per_order: hist(pp, (x) => String(x.n)) });
const mailCount = (await (await fetch(`${process.env.MAILPIT ?? "http://localhost:58025"}/api/v1/search?query=${encodeURIComponent(`to:race-${S.run}`)}&limit=1`)).json()).messages_count;
check('C2c', 'potvrzovaci e-maily: 1 na objednavku (ocekavano 10), ne duplicitni', mailCount === CAP, { mailsToRaceBuyers: mailCount, expected: CAP });

// ---------- C3: zavod na promo kod (max 5) ----------
const code = `RACE${Date.now().toString(36)}`.toUpperCase();
let r = await PA.post('/api/admin/promo-codes', { code, type: 'percentage', discountValue: 50, maxUses: 5 });
const big = await mkType(`Promo race ${Date.now()}`, 500);
const pr = await Promise.all(Array.from({ length: 40 }, (_, i) => new Client(`p${i}`).post('/api/checkout', { eventId: S.eventA, ticketTypeId: big, quantity: 1, buyerEmail: `promo-${S.run}-${Date.now()}-${i}@audit.test`, buyerName: `Promo ${i}`, promoCode: code })));
const applied = pr.filter((x) => x.json?.promoCodeApplied === true).length;
const uses = (await q(`SELECT uses_count, max_uses FROM marketing.promo_codes WHERE code=$1`, [code]))[0];
check('C3', 'zavod: 40 soubeznych pouziti promo kodu s max_uses=5 -> sleva aplikovana max 5x', applied <= 5 && uses.uses_count <= 5, { create: r.status, applied, db: uses, responses: hist(pr, key) });

// ---------- C4: zavod na limit na osobu (max 2) ----------
const lim = await mkType(`Limit race ${Date.now()}`, 500, { maxPerUser: 2 });
// kolo 2: vlastni kupec na scenar (per-e-mail/per-IP limit checkoutu z K3)
// Soubeh tehoz uzivatele: 15 pozadavku z ruznych IP (jinak by per-IP limit 10 zkreslil, co se meri).
const sC4 = await scenarioBuyer(S, `C4-${Date.now().toString(36)}`);
const lr = await Promise.all(Array.from({ length: 15 }, () => { const ip = new Client('ip').ip; return sC4.c.post('/api/checkout', { eventId: S.eventA, ticketTypeId: lim, quantity: 1, buyerEmail: sC4.email, buyerName: 'Kupec Audit' }, { 'x-real-ip': ip, 'x-forwarded-for': ip }); }));
const got = (await q(`SELECT COALESCE(sum(oi.quantity),0)::int n FROM orders.orders o JOIN orders.order_items oi ON oi.order_id=o.id WHERE oi.ticket_type_id=$1 AND o.user_id=$2 AND o.status IN ('pending','paid')`, [lim, sC4.id]))[0].n;
check('C4', 'zavod: 15 soubeznych nakupu tehoz uzivatele pri limitu 2 ks/osobu -> max 2 ks', got <= 2, { boughtQty: got, responses: hist(lr, key) });

// ---------- C5: checkout nema rate limit? ----------
const one = new Client('flood');
const fl = await Promise.all(Array.from({ length: 60 }, (_, i) => one.post('/api/checkout', { eventId: S.eventA, ticketTypeId: big, quantity: 1, buyerEmail: `flood-${S.run}-${i}@audit.test`, buyerName: 'Flood' })));
const rem = await ttRow(big);
check('C5', 'rate limiting nakupu: 60 checkoutu z JEDNE IP behem vterin -> cast odmitnuta 429', fl.some((x) => x.status === 429), { responses: hist(fl, key), heldByOneIp: fl.filter((x) => x.status === 200).length, remaining: rem });

summary();
await owner.end();
