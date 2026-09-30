// E2E 06: bezpecnost — neautentizovane "demo" cesty v produkcnim rezimu, tokeny, CSRF, rate limit loginu,
// interni/cron endpointy, uvolneni mist po zruseni platby, validace vstupu.
import { readFileSync } from 'node:fs';
import { Client, q, owner, check, ev, startLog, summary, gopayCtl, sleep, mails, waitFor, INTERNAL_TOKEN, BASE } from './lib.mjs';

startLog('06_security');
const S = JSON.parse(readFileSync(new URL('./state.json', import.meta.url), 'utf8'));
const login = async (name, email) => { const c = new Client(name); const r = await c.post('/api/auth/login', { email, password: S.pw }); if (r.status !== 200) throw new Error(`login ${email} ${r.status} ${r.text}`); return { c, json: r.json }; };
const anon = () => new Client('anon');
const ttRow = async (id) => (await q(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [id]))[0].remaining_qty;

// ---------- K1: kiosk/order — placene vstupenky bez platby a bez prihlaseni ----------
const slug = (await q(`SELECT slug FROM platform.promoters WHERE id=$1`, [S.promoterA.id]))[0].slug;
let r = await anon().post('/api/kiosk/order', { promoterSlug: slug, eventId: S.eventA, ticketTypeId: S.tt['Stani'], quantity: 2, buyerEmail: `attacker-${S.run}@audit.test`, buyerName: 'Utocnik' });
const ko = r.json?.orderId ? (await q(`SELECT status, total_amount, payment_provider FROM orders.orders WHERE id=$1`, [r.json.orderId]))[0] : null;
const kt = r.json?.orderId ? await q(`SELECT status FROM tickets.tickets WHERE order_id=$1`, [r.json.orderId]) : [];
check('K1', 'NEPRIHLASENY utocnik ziska pres /api/kiosk/order platne vstupenky za 1000 Kc ZDARMA (NODE_ENV=production)', !(r.status === 200 && ko?.status === 'paid' && kt.length === 2), { status: r.status, body: JSON.stringify(r.json).slice(0, 300), orderInDb: ko, ticketsIssued: kt.map((t) => t.status), responseLeaksTotpSecret: /totp|secret/i.test(JSON.stringify(r.json ?? '')) });
S.kioskTicket = null;
if (r.json?.orderId) {
  const tid = (await q(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [r.json.orderId]))[0]?.id;
  const PAc = (await login('promoterA', S.promoterA.email)).c;
  const sc = await PAc.post('/api/admin/scanner/validate', { ticketId: tid });
  check('K1b', 'takto ziskana vstupenka projde u brany (admitted)', sc.json?.result !== 'admitted', ev(sc));
}

// ---------- K2: dalsi neautentizovane potvrzovaci endpointy ----------
r = await anon().post('/api/vouchers/holders/nonexistent-payment/confirm', { action: 'pay' });
check('K2a', '/api/vouchers/holders/[paymentId]/confirm bez autentizace: endpoint je dosazitelny v produkcnim rezimu (neni 401/403)', r.status === 401 || r.status === 403, ev(r));
r = await anon().post('/api/subscriptions/holders/nonexistent-payment/confirm', { action: 'pay' });
check('K2b', '/api/subscriptions/holders/[paymentId]/confirm bez autentizace: dosazitelny v produkcnim rezimu (neni 401/403)', r.status === 401 || r.status === 403, ev(r));
r = await anon().post(`/api/mock-gopay/${S.pids.pid3}`, { action: 'pay' });
const o3 = (await q(`SELECT status FROM orders.orders WHERE id=$1`, [S.orders.o3]))[0].status;
check('K2c', 'mock platebni brana je v produkcnim rezimu zablokovana (403) a objednavku neoznaci paid', r.status === 403 && o3 === 'pending', { ...ev(r), orderStatus: o3 });

// ---------- K3: interni a cron endpointy ----------
r = await anon().post('/api/internal/cron/recompute-dynamic-pricing', {});
check('K3a', 'cron recompute-dynamic-pricing (prepisuje ceny) vyzaduje token', r.status === 401 || r.status === 403, ev(r));
r = await anon().post('/api/internal/cron/expire-pending-orders', {});
check('K3b', 'cron expire-pending-orders vyzaduje token', r.status === 401 || r.status === 403, ev(r));
r = await anon().get('/api/cron/dispatch?job=expire-pending-orders', { 'x-vercel-cron': '1' });
check('K3c', 'cron dispatcher s podvrzenou hlavickou x-vercel-cron (CRON_SECRET nastaven) odmitnut', r.status === 401 || r.status === 403, ev(r));
r = await anon().post('/api/internal/order-completed', { orderId: S.orders.o1 }, { 'x-internal-token': 'wrong' });
check('K3d', 'order-completed se spatnym tokenem odmitnut', r.status === 401 || r.status === 403, ev(r));

// ---------- K4: tokeny ----------
const L = await login('buyer', S.buyerEmail);
const buyer = L.c;
const tk = (await q(`SELECT t.id FROM tickets.tickets t WHERE t.owner_id=$1 AND t.status='valid' LIMIT 1`, [S.buyerId]))[0].id;
r = await anon().get(`/api/buyer/tickets/${tk}/totp`, { 'x-user-id': S.buyerId });
check('K4a', 'podvrzena hlavicka x-user-id bez tokenu -> 401', r.status === 401, ev(r));
const at = L.json.accessToken; const parts = at.split('.');
const forged = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${parts[1]}.`;
r = await anon().get(`/api/buyer/tickets/${tk}/totp`, { authorization: `Bearer ${forged}` });
check('K4b', 'JWT alg=none odmitnut', r.status === 401, ev(r));
const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
const evil = `${parts[0]}.${Buffer.from(JSON.stringify({ ...payload, isPlatformAdmin: true, roles: { isPlatformAdmin: true, promoterMemberships: [] } })).toString('base64url')}.${parts[2]}`;
r = await anon().get('/api/platform/promoters', { authorization: `Bearer ${evil}` });
check('K4c', 'JWT s upravenym payloadem (isPlatformAdmin) a puvodnim podpisem odmitnut', r.status === 401 || r.status === 403, ev(r));
const refreshCookie = [...buyer.cookies].find(([k]) => /refresh/i.test(k));
if (refreshCookie) {
  r = await anon().get(`/api/buyer/tickets/${tk}/totp`, { authorization: `Bearer ${refreshCookie[1]}` });
  check('K4d', 'REFRESH token (7 dni) pouzity jako access token na /api/buyer/* odmitnut', r.status === 401, { ...ev(r), cookieName: refreshCookie[0], accessTtl: payload.exp - payload.iat });
} else check('K4d', 'refresh cookie nenalezena', null, [...buyer.cookies.keys()]);
const lg = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '10.99.0.1' }, body: JSON.stringify({ email: S.buyerEmail, password: S.pw }) });
const sc = lg.headers.getSetCookie();
check('K4e', 'auth cookies: HttpOnly + SameSite (+Secure v produkci)', sc.length > 0 && sc.every((c) => /httponly/i.test(c) && /samesite=(lax|strict)/i.test(c)), sc.map((c) => c.replace(/=[^;]+/, '=<redacted>')));

// ---------- K5: CSRF ----------
r = await buyer.post('/api/checkout', { eventId: S.eventA, ticketTypeId: S.tt['Stani'], quantity: 1, buyerEmail: S.buyerEmail, buyerName: 'Kupec Audit' }, { origin: 'https://evil.example', referer: 'https://evil.example/x' });
check('K5', 'CSRF: stavovy POST s cookie a cizim Origin (https://evil.example) odmitnut serverem', r.status === 403, { status: r.status, note: 'ochrana stoji jen na SameSite cookie; server Origin neoveruje', body: JSON.stringify(r.json).slice(0, 120) });

// ---------- K6: rate limit loginu ----------
const bf = new Client('bruteforce'); const codes = [];
for (let i = 0; i < 14; i++) codes.push((await bf.post('/api/auth/login', { email: `victim-${S.run}@audit.test`, password: `wrong-${i}-xxxx` })).status);
check('K6a', 'rate limit loginu: 14 pokusu z jedne IP -> 429 po 10', codes.slice(10).every((c) => c === 429) && codes.slice(0, 10).every((c) => c === 401), { codes });
const acct = []; for (let i = 0; i < 14; i++) acct.push((await new Client(`rot${i}`).post('/api/auth/login', { email: S.otherEmail, password: `wrong-${i}-xxxx` })).status);
check('K6b', 'rate limit loginu per ucet: 14 pokusu na 1 ucet z 14 ruznych IP -> zablokovano', acct.includes(429), { codes: acct });

// ---------- K7: zruseni platby u brany uvolni mista? ----------
const before = await ttRow(S.tt['Stani']);
r = await buyer.post('/api/checkout', { eventId: S.eventA, ticketTypeId: S.tt['Stani'], quantity: 3, buyerEmail: S.buyerEmail, buyerName: 'Kupec Audit' });
await gopayCtl(r.json.paymentId, { state: 'CANCELED' });
const wh = await anon().get(`/api/payments/gopay/webhook?id=${r.json.paymentId}`);
const st = (await q(`SELECT status FROM orders.orders WHERE id=$1`, [r.json.orderId]))[0].status;
const after = await ttRow(S.tt['Stani']);
check('K7', 'platba zrusena u brany (CANCELED): objednavka cancelled A 3 mista vracena do prodeje', st === 'cancelled' && after === before, { webhook: ev(wh), orderStatus: st, remainingBefore: before, remainingAfter: after, leaked: before - after });

// ---------- K8: validace vstupu / injection ----------
r = await anon().get(`/api/events/${encodeURIComponent("1' OR '1'='1")}/ticket-types`);
check('K8a', 'SQLi retezec v ID v URL -> 4xx, ne 500', r.status >= 400 && r.status < 500, { status: r.status, body: r.text.slice(0, 100) });
const xss = '<img src=x onerror=alert(1)>';
const xe = `xss-${S.run}@audit.test`;
r = await anon().post('/api/checkout', { eventId: S.eventA, ticketTypeId: S.tt['Stani'], quantity: 1, buyerEmail: xe, buyerName: xss });
if (r.json?.paymentId) {
  await gopayCtl(r.json.paymentId, { state: 'PAID' }); await anon().get(`/api/payments/gopay/webhook?id=${r.json.paymentId}`);
  const m = await waitFor(async () => { const x = await mails(`to:${xe}`); return x.length ? x : null; }, 20000);
  if (m) {
    const full = await (await fetch(`http://localhost:58025/api/v1/message/${m[0].ID}`)).json();
    check('K8b', 'HTML e-mail escapuje jmeno kupce (XSS payload neni v HTML surovy)', !(full.HTML ?? '').includes(xss), { containsRaw: (full.HTML ?? '').includes(xss), containsEscaped: (full.HTML ?? '').includes('&lt;img') });
  } else check('K8b', 'e-mail nedorazil', null, {});
} else check('K8b', 'checkout s HTML ve jmene', null, ev(r));
r = await anon().post('/api/checkout', 'not-json{{{', { 'content-type': 'application/json' });
check('K8c', 'nevalidni JSON -> 4xx', r.status >= 400 && r.status < 500, ev(r));

// ---------- K9: bezpecnostni hlavicky ----------
const pg = await fetch(`${BASE}/cs`, { redirect: 'manual' });
const hs = Object.fromEntries(['content-security-policy', 'strict-transport-security', 'x-frame-options', 'x-content-type-options', 'referrer-policy'].map((h) => [h, (pg.headers.get(h) ?? '').slice(0, 80) || null]));
check('K9', 'bezpecnostni hlavicky na HTML strance', !!hs['x-content-type-options'] && (!!hs['x-frame-options'] || /frame-ancestors/.test(pg.headers.get('content-security-policy') ?? '')), { status: pg.status, ...hs });

summary();
await owner.end();
