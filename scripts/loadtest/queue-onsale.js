/**
 * k6 load test: simuluje on-sale moment pro Tomorrowland-class festival.
 *
 * Scénář (3 stages):
 *   Stage 1 (warm-up): 0 → 1k VUs za 30s, hold 1 min
 *   Stage 2 (ramp):     1k → 50k VUs za 2 min, hold 2 min
 *   Stage 3 (spike):    50k → 100k VUs za 1 min, hold 1 min
 *
 * Každý VU:
 *   1. POST /api/queue/{eventId}/join (zaregistruje fingerprint)
 *   2. Loop GET /api/queue/{eventId}/status/{token} every 3s do admitted nebo timeout 5 min
 *   3. POST /api/checkout (s queueToken)
 *
 * Metriky:
 *   - http_req_duration{p95, p99}
 *   - queue_join_latency
 *   - admit_latency (čas od join do admitted)
 *   - checkout_success_rate
 *
 * Použití (lokální):
 *   k6 run -e EVENT_ID=<uuid> -e TICKET_TYPE_ID=<uuid> -e BASE_URL=http://localhost:3000 \
 *     scripts/loadtest/queue-onsale.js
 *
 * Pro tier-1 festival load test:
 *   k6 run --vus 100000 --duration 5m queue-onsale.js
 *
 * Předtím nutno:
 *   1. Vytvořit testing event s queue_enabled=true a queue_max_concurrent=1000
 *   2. Mít Redis dostupný (REDIS_URL set)
 *   3. Postgres connection pool size minimum 50
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const EVENT_ID = __ENV.EVENT_ID || (() => { throw new Error('EVENT_ID env required'); })();
const TICKET_TYPE_ID =
  __ENV.TICKET_TYPE_ID ||
  (() => {
    throw new Error('TICKET_TYPE_ID env required');
  })();

const queueJoinLatency = new Trend('queue_join_latency_ms');
const admitLatency = new Trend('admit_latency_seconds');
const checkoutSuccessRate = new Rate('checkout_success_rate');
const queueAbandonedCounter = new Counter('queue_abandoned');

export const options = {
  scenarios: {
    onsale: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 1000 }, // warm-up
        { duration: '1m', target: 1000 }, // hold
        { duration: '2m', target: 50000 }, // ramp to 50k
        { duration: '2m', target: 50000 }, // hold 50k
        { duration: '1m', target: 100000 }, // spike to 100k
        { duration: '1m', target: 100000 }, // hold spike
        { duration: '30s', target: 0 }, // cool-down
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    queue_join_latency_ms: ['p(95)<1500'],
    checkout_success_rate: ['rate>0.7'], // 70 % buyers, kteří byli admitnuti, projdou checkoutem
  },
};

function fingerprint() {
  return `fp_${uuidv4().slice(0, 12)}`;
}

export default function () {
  const fp = fingerprint();
  const buyerEmail = `loadtest-${fp}@example.com`;

  // 1) Join queue
  const joinStart = Date.now();
  const joinRes = http.post(
    `${BASE_URL}/api/queue/${EVENT_ID}/join`,
    JSON.stringify({ fingerprint: fp, formStartedAt: Date.now() - 5000 }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  queueJoinLatency.add(Date.now() - joinStart);
  check(joinRes, { 'join 200/201': (r) => r.status === 200 || r.status === 201 });
  if (joinRes.status >= 400) {
    return;
  }
  const joinJson = joinRes.json();
  if (!joinJson.token) {
    // queue disabled or some other issue
    return;
  }
  const token = joinJson.token;

  // 2) Poll status until admitted or 5 min timeout
  const startWait = Date.now();
  let admitted = false;
  while (Date.now() - startWait < 5 * 60 * 1000) {
    sleep(3);
    const sRes = http.get(`${BASE_URL}/api/queue/${EVENT_ID}/status/${token}`);
    if (sRes.status !== 200) continue;
    const sJson = sRes.json();
    if (sJson.status === 'admitted') {
      admitted = true;
      admitLatency.add((Date.now() - startWait) / 1000);
      break;
    }
    if (sJson.status === 'expired' || sJson.status === 'cancelled') {
      queueAbandonedCounter.add(1);
      return;
    }
  }
  if (!admitted) {
    queueAbandonedCounter.add(1);
    return;
  }

  // 3) Checkout
  const checkoutRes = http.post(
    `${BASE_URL}/api/checkout`,
    JSON.stringify({
      eventId: EVENT_ID,
      ticketTypeId: TICKET_TYPE_ID,
      quantity: 1,
      buyerEmail,
      buyerName: `Load Test ${fp}`,
      paymentMethod: 'gopay',
      queueToken: token,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const ok = checkoutRes.status >= 200 && checkoutRes.status < 300;
  checkoutSuccessRate.add(ok);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data),
    'loadtest-report.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data) {
  const m = data.metrics;
  const p = (key) => m[key]?.values || {};
  return `
=== TIXLY LOAD TEST REPORT ===

Scenario: on-sale ramp 0 → 100k VUs

http_req_duration:
  p50:   ${p('http_req_duration').med?.toFixed(0)}ms
  p95:   ${p('http_req_duration')['p(95)']?.toFixed(0)}ms
  p99:   ${p('http_req_duration')['p(99)']?.toFixed(0)}ms

queue_join_latency:
  p95:   ${p('queue_join_latency_ms')['p(95)']?.toFixed(0)}ms

admit_latency (sec from join to admitted):
  avg:   ${p('admit_latency_seconds').avg?.toFixed(1)}s
  p95:   ${p('admit_latency_seconds')['p(95)']?.toFixed(1)}s

checkout_success_rate: ${(p('checkout_success_rate').rate * 100).toFixed(1)}%
queue_abandoned:       ${p('queue_abandoned').count ?? 0}

Total requests: ${p('http_reqs').count ?? 0}
Total VU iterations: ${p('iterations').count ?? 0}
HTTP errors: ${p('http_req_failed').rate ? (p('http_req_failed').rate * 100).toFixed(2) : '0.00'}%

`;
}
