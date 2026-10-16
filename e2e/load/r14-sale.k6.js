/**
 * Kolo 14 / krok 2 — nápor při spuštění prodeje (k6): 300 virtuálních kupců během 60 s na termín se 500 místy.
 *
 * Každý kupec: stránka termínu → plánek (seznam míst + ceny) → hold 1–4 míst (30 % míří do „nejlepších" řad 1–3 → kolize)
 * → checkout → simulovaná platba (simulátor GoPay: stav PAID) → webhook brány (GET /api/payments/gopay/webhook?id=).
 * Při kolizi holdu (409) jeden nový pokus s jinými místy z čerstvého plánku. Každý kupec má vlastní IP (limity objednávek).
 *
 *   docker run --rm -v <repo>/e2e/load:/load -v <repo>/logs/r14/load:/out grafana/k6 run \
 *     -e BASE=http://host.docker.internal:3200 -e GW=http://host.docker.internal:3998 -e SETUP=/out/setup.json /load/r14-sale.k6.js
 */
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import { sleep } from 'k6';

const BASE = __ENV.BASE || 'http://host.docker.internal:3200';
const GW = __ENV.GW || 'http://host.docker.internal:3998';
const SETUP = JSON.parse(open(__ENV.SETUP || '/out/setup.json'));
const VUS = Number(__ENV.VUS || 300);
const SPREAD_S = Number(__ENV.SPREAD_S || 60);

export const options = {
  scenarios: { sale: { executor: 'per-vu-iterations', vus: VUS, iterations: 1, maxDuration: '6m' } },
  summaryTrendStats: ['p(50)', 'p(95)', 'p(99)', 'max', 'count'],
  discardResponseBodies: false,
};

const STEPS = ['page', 'plan', 'hold', 'checkout', 'pay', 'webhook'];
const T = Object.fromEntries(STEPS.map((s) => [s, new Trend(`t_${s}`, true)]));
const ERR = Object.fromEntries(STEPS.map((s) => [s, new Counter(`err_${s}`)]));      // 5xx / síť / neočekávaný kód
const S503 = Object.fromEntries(STEPS.map((s) => [s, new Counter(`s503_${s}`)]));    // řízené 503 + Retry-After
const S503F = Object.fromEntries(STEPS.map((s) => [s, new Counter(`s503final_${s}`)])); // 503 i po opakování
const OK = Object.fromEntries(STEPS.map((s) => [s, new Counter(`ok_${s}`)]));
const holdConflict = new Counter('hold_conflict');   // 409 kolize (očekávané)
const soldOut = new Counter('sold_out');             // nezbyla volná místa (očekávané po vyprodání)
const bought = new Counter('bought_seats');
const harnessRetry = new Counter('harness_retry_pay'); // síť Docker → simulátor (ne aplikace)

function track(step, res, expected) {
  T[step].add(res.timings.duration);
  if (res.status === 503 && res.headers['Retry-After']) S503F[step].add(1); // řízené 503 i po opakování (ne chyba)
  else if (res.status === 0 || res.status >= 500 || !expected.includes(res.status)) ERR[step].add(1, { status: String(res.status) });
  else OK[step].add(1);
  return res;
}

/** Klient jako prohlížeč / GoPay: na řízené 503 + Retry-After jednou počká a zopakuje (počítá se zvlášť). */
function withRetry(step, doReq) {
  let r = doReq();
  if (r.status === 503 && r.headers['Retry-After']) {
    S503[step].add(1);
    sleep(Number(r.headers['Retry-After']) || 1);
    r = doReq();
  }
  return r;
}

function pick(seatsAvail, n, hot) {
  const pool = hot ? seatsAvail.filter((s) => s.row <= 3) : seatsAvail;
  const src = pool.length >= n ? pool : seatsAvail;
  if (src.length < n) return null;
  const start = Math.floor(Math.random() * (src.length - n + 1));
  return src.slice(start, start + n);
}

export default function () {
  const vu = __VU;
  const ip = `10.${200 + (vu % 50)}.${Math.floor(vu / 250)}.${(vu % 250) + 1}`;
  const H = { headers: { 'x-real-ip': ip, 'content-type': 'application/json', origin: BASE } };
  sleep(Math.random() * SPREAD_S);
  const ev = SETUP.eventId;

  track('page', http.get(`${BASE}/cs/events/${ev}`, H), [200]);
  let plan = track('plan', withRetry('plan', () => http.get(`${BASE}/api/events/${ev}/seats`, H)), [200]);
  http.get(`${BASE}/api/public/events/${ev}/seat-prices`, H);

  const n = 1 + Math.floor(Math.random() * 4);
  const hot = Math.random() < 0.3;
  let held = null; let token = null;
  for (let attempt = 0; attempt < 2 && !held; attempt++) {
    let avail = [];
    try { avail = (plan.json('seats') || []).filter((s) => s.status === 'available'); } catch (e) { avail = []; }
    const byId = new Map(SETUP.seats.map((s) => [s.id, s]));
    const choice = pick(avail.map((s) => byId.get(s.id)).filter(Boolean), n, hot && attempt === 0);
    if (!choice) { soldOut.add(1); return; }
    const r = track('hold', withRetry('hold', () => http.post(`${BASE}/api/events/${ev}/seats/hold`, JSON.stringify({ seatIds: choice.map((s) => s.id) }), H)), [200, 409]);
    if (r.status === 200) { held = choice; token = r.json('holdToken'); break; }
    if (r.status === 409) { holdConflict.add(1); plan = http.get(`${BASE}/api/events/${ev}/seats`, H); continue; }
    return;
  }
  if (!held) return;

  const email = `zatez-${vu}-${Date.now()}@kupec.test`;
  const co = track('checkout', withRetry('checkout', () => http.post(`${BASE}/api/checkout/seats`, JSON.stringify({
    eventId: ev, seatHoldToken: token, items: held.map((s) => ({ seatId: s.id, categoryId: SETUP.categoryId })),
    buyerEmail: email, buyerName: `Kupec ${vu}`,
  }), H)), [200]);
  if (co.status !== 200) return;
  const paymentId = co.json('paymentId');
  const amount = co.json('totalAmount');

  if (__ENV.PAYFLOW === '0') return; // diagnostika: jen stránka, plánek, hold a checkout
  // simulátor brány běží na hostiteli — síťové selhání Docker → hostitel (status 0) jednou zopakovat a započítat zvlášť
  let pay = http.post(`${GW}/_ctl/${paymentId}`, JSON.stringify({ state: 'PAID', amount }), { headers: { 'content-type': 'application/json' } });
  if (pay.status === 0) { harnessRetry.add(1); pay = http.post(`${GW}/_ctl/${paymentId}`, JSON.stringify({ state: 'PAID', amount }), { headers: { 'content-type': 'application/json' } }); }
  track('pay', pay, [200]);
  const wh = track('webhook', withRetry('webhook', () => http.get(`${BASE}/api/payments/gopay/webhook?id=${paymentId}`, H)), [200]);
  if (wh.status === 200) bought.add(held.length);
}
