// Simulátor GoPay REST API pro testy (podmnožina, kterou volá src/lib/payment/gopay-real.ts).
// NENÍ to reálná brána. Rozšířeno o řízení refundu (success / error / timeout) pro K2.
//
//   POST /api/oauth2/token                 -> access_token
//   POST /api/payments/payment             -> {id, gw_url}   (state CREATED)
//   GET  /api/payments/payment/:id         -> {id,state,amount,currency}
//   POST /api/payments/payment/:id/refund  -> dle refundMode dané platby
//
// Kolo 2 (krok 1) — navíc simulace dalších bran pro ověření stavu platby dotazem na API:
//   PayPal   POST /paypal/v2/checkout/orders/:id/capture, /paypal/v1/oauth2/token, /paypal/v1/notifications/verify-webhook-signature
//            (SUCCESS jen pro transmission_sig === 'valid-sig'), GET /paypal/v2/checkout/orders/:id
//   Stripe   GET /stripe/v1/checkout/sessions/:id, POST + GET /stripe/v1/payment_intents[/:id] (kolo 3 — mobilní platba)
//   Triple-A POST /triplea/oauth/token, GET /triplea/payment/:ref
//   Wise     GET /wise/v1/transfers/:id
//   Mollie   GET /mollie/v2/payments/:id
//   Spotify  POST /spotify-accounts/api/token, GET /spotify-api/v1/me[/top/artists] (kolo 3)
//   Řízení:  POST /_ctl/ext/:provider/:id  {…objekt vracený API…}
//
// Řízení z testu:
//   POST /_ctl/:id        {"state":"PAID","amount":123}    nastaví stav platby
//   POST /_ctl/:id/refundmode  {"mode":"ok|error|timeout"} nastaví chování refundu
//   GET  /_ctl/payments                                    seznam plateb
//   GET  /_ctl/log                                         seznam volání (i refundů)
import http from 'node:http';
import { appendFileSync } from 'node:fs';

const PORT = Number(process.env.FAKE_GOPAY_PORT ?? 3998);
const LOG = process.env.FAKE_GOPAY_LOG ?? null;
const payments = new Map();
const ext = { paypal: new Map(), stripe: new Map(), triplea: new Map(), wise: new Map(), mollie: new Map() };
const calls = [];
// Start z času: po restartu simulátoru se ID plateb NESMÍ opakovat (jinak webhook najde
// starou objednávku se stejným gopay_payment_id z dřívějšího běhu proti téže DB).
let seq = 3000000000 + (Date.now() % 1_000_000_000);

const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const body = await readBody(req);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const entry = { t: new Date().toISOString(), method: req.method, path: url.pathname, body: body.slice(0, 2000) };
  if (!url.pathname.startsWith('/_ctl')) { calls.push(entry); if (LOG) appendFileSync(LOG, JSON.stringify(entry) + '\n'); }
  let m;

  if (req.method === 'POST' && url.pathname === '/api/oauth2/token')
    return send(res, 200, { access_token: 'fake-token', token_type: 'bearer', expires_in: 1800 });

  if (req.method === 'POST' && url.pathname === '/api/payments/payment') {
    const p = JSON.parse(body || '{}');
    const id = String(++seq);
    payments.set(id, { id, state: 'CREATED', amount: p.amount, currency: p.currency, order_number: p.order_number, notification_url: p.callback?.notification_url, refunds: [], refundMode: 'ok' });
    return send(res, 200, { id: Number(id), gw_url: `http://localhost:${PORT}/gw/${id}`, state: 'CREATED' });
  }

  if ((m = url.pathname.match(/^\/api\/payments\/payment\/(\d+)$/)) && req.method === 'GET') {
    const p = payments.get(m[1]);
    if (!p) return send(res, 404, { errors: [{ error_name: 'PAYMENT_NOT_FOUND' }] });
    return send(res, 200, { id: Number(p.id), state: p.state, amount: p.amount, currency: p.currency, order_number: p.order_number });
  }

  if ((m = url.pathname.match(/^\/api\/payments\/payment\/(\d+)\/refund$/)) && req.method === 'POST') {
    const p = payments.get(m[1]);
    if (!p) return send(res, 404, { errors: [{ error_name: 'PAYMENT_NOT_FOUND' }] });
    const amount = Number(new URLSearchParams(body).get('amount'));
    if (p.refundMode === 'timeout') {
      // Nikdy neodpovíme → klientův AbortSignal/timeout se uplatní. Spojení držíme otevřené.
      return;
    }
    if (p.refundMode === 'error') {
      return send(res, 500, { result: 'FAILED', error_name: 'REFUND_FAILED' });
    }
    // ok: idempotentní — započítá se jen jednou na (paymentId, amount)
    if (!p.refunds.includes(amount)) p.refunds.push(amount);
    p.state = p.refunds.reduce((a, b) => a + b, 0) >= p.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    return send(res, 200, { id: Number(p.id), result: 'FINISHED', state: p.state, amount });
  }

  if ((m = url.pathname.match(/^\/_ctl\/(\d+)\/refundmode$/)) && req.method === 'POST') {
    const p = payments.get(m[1]); if (!p) return send(res, 404, { error: 'unknown' });
    p.refundMode = JSON.parse(body || '{}').mode ?? 'ok';
    return send(res, 200, { id: p.id, refundMode: p.refundMode });
  }
  if ((m = url.pathname.match(/^\/_ctl\/(\d+)$/)) && req.method === 'POST') {
    const p = payments.get(m[1]); if (!p) return send(res, 404, { error: 'unknown' });
    const c = JSON.parse(body || '{}');
    if (c.state) p.state = c.state;
    if (c.amount !== undefined) p.amount = c.amount;
    return send(res, 200, p);
  }
  // ---- ostatní brány (kolo 2) ----
  if ((m = url.pathname.match(/^\/_ctl\/ext\/(paypal|stripe|triplea|wise|mollie)\/([^/]+)$/)) && req.method === 'POST') {
    ext[m[1]].set(decodeURIComponent(m[2]), JSON.parse(body || '{}'));
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && (url.pathname === '/paypal/v1/oauth2/token' || url.pathname === '/triplea/oauth/token'))
    return send(res, 200, { access_token: 'fake-ext-token', token_type: 'bearer', expires_in: 3600 });
  if (req.method === 'POST' && url.pathname === '/paypal/v1/notifications/verify-webhook-signature') {
    const b = JSON.parse(body || '{}');
    return send(res, 200, { verification_status: b.transmission_sig === 'valid-sig' && b.webhook_id ? 'SUCCESS' : 'FAILURE' });
  }
  if (req.method === 'POST' && (m = url.pathname.match(/^\/paypal\/v2\/checkout\/orders\/([^/]+)\/capture$/))) {
    const o = ext.paypal.get(decodeURIComponent(m[1]));
    if (!o) return send(res, 404, { name: 'RESOURCE_NOT_FOUND' });
    if (o.captured) return send(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] });
    o.captured = true; o.status = 'COMPLETED';
    return send(res, 201, o);
  }
  for (const [prov, re] of [['paypal', /^\/paypal\/v2\/checkout\/orders\/([^/]+)$/], ['stripe', /^\/stripe\/v1\/checkout\/sessions\/([^/]+)$/], ['stripe', /^\/stripe\/v1\/payment_intents\/([^/]+)$/],
    ['triplea', /^\/triplea\/payment\/([^/]+)$/], ['mollie', /^\/mollie\/v2\/payments\/([^/]+)$/], ['wise', /^\/wise\/v1\/transfers\/([^/]+)$/]]) {
    if (req.method === 'GET' && (m = url.pathname.match(re))) {
      if (!/^Bearer /.test(req.headers.authorization ?? '')) return send(res, 401, { error: 'no auth' });
      const o = ext[prov].get(decodeURIComponent(m[1]));
      return o ? send(res, 200, o) : send(res, 404, { error: 'NOT_FOUND' });
    }
  }
  if (req.method === 'POST' && url.pathname === '/stripe/v1/payment_intents') {
    if (!/^Bearer /.test(req.headers.authorization ?? '')) return send(res, 401, { error: { message: 'no auth' } });
    const p = new URLSearchParams(body);
    const id = `pi_fake_${++seq}`;
    const pi = { id, client_secret: `${id}_secret_fake`, amount: Number(p.get('amount')), currency: p.get('currency'), status: 'requires_payment_method', metadata: { orderId: p.get('metadata[orderId]') } };
    ext.stripe.set(id, pi);
    return send(res, 200, pi);
  }
  // ---- Spotify (kolo 3 — OAuth callback) ----
  if (req.method === 'POST' && url.pathname === '/spotify-accounts/api/token') {
    return send(res, 200, { access_token: 'fake-sp-access', refresh_token: 'fake-sp-refresh', expires_in: 3600, token_type: 'Bearer', scope: 'user-top-read user-read-private' });
  }
  if (req.method === 'GET' && url.pathname === '/spotify-api/v1/me') {
    if (!/^Bearer /.test(req.headers.authorization ?? '')) return send(res, 401, { error: 'no auth' });
    return send(res, 200, { id: 'fix-spotify-user', display_name: 'Fix Spotify' });
  }
  if (req.method === 'GET' && url.pathname === '/spotify-api/v1/me/top/artists') {
    if (!/^Bearer /.test(req.headers.authorization ?? '')) return send(res, 401, { error: 'no auth' });
    return send(res, 200, { items: [{ id: 'sp-a1', name: 'Fix Kapela OAuth', genres: ['indie'] }, { id: 'sp-a2', name: 'Druhá Kapela', genres: ['rock'] }] });
  }
  if (url.pathname === '/_ctl/payments') return send(res, 200, [...payments.values()]);
  if (url.pathname === '/_ctl/log') return send(res, 200, calls);
  if (url.pathname === '/_ctl/refund-calls') return send(res, 200, calls.filter((c) => /\/refund$/.test(c.path)));
  send(res, 404, { error: 'not simulated', path: url.pathname });
}).listen(PORT, () => console.log(`fake-gopay(fix) on ${PORT}`));
