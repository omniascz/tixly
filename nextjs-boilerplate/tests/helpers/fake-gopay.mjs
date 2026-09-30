// Simulátor GoPay REST API pro testy (podmnožina, kterou volá src/lib/payment/gopay-real.ts).
// NENÍ to reálná brána. Rozšířeno o řízení refundu (success / error / timeout) pro K2.
//
//   POST /api/oauth2/token                 -> access_token
//   POST /api/payments/payment             -> {id, gw_url}   (state CREATED)
//   GET  /api/payments/payment/:id         -> {id,state,amount,currency}
//   POST /api/payments/payment/:id/refund  -> dle refundMode dané platby
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
const calls = [];
let seq = 3000000000;

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
  if (url.pathname === '/_ctl/payments') return send(res, 200, [...payments.values()]);
  if (url.pathname === '/_ctl/log') return send(res, 200, calls);
  if (url.pathname === '/_ctl/refund-calls') return send(res, 200, calls.filter((c) => /\/refund$/.test(c.path)));
  send(res, 404, { error: 'not simulated', path: url.pathname });
}).listen(PORT, () => console.log(`fake-gopay(fix) on ${PORT}`));
