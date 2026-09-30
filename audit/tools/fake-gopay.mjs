// Simulator GoPay REST API (podmnozina, kterou pouziva src/lib/payment/gopay-real.ts).
// Aplikace na nej miri pres GOPAY_API_BASE_URL=http://localhost:3999/api. Zadna realna brana.
// Kazde volani se loguje do audit/logs/fake-gopay.jsonl (dukaz, co aplikace s branou delala).
//   POST /api/oauth2/token                 -> access_token
//   POST /api/payments/payment             -> {id, gw_url}      (state CREATED)
//   GET  /api/payments/payment/:id         -> {id,state,amount,currency}
//   POST /api/payments/payment/:id/refund  -> {id,result:'FINISHED'}  (state REFUNDED)
// Rizeni testu:
//   POST /_ctl/:id  {"state":"PAID","amount":123}   nastavi stav (amount volitelne)
//   GET  /_ctl/payments                             vsechny platby
//   GET  /_ctl/log                                  vsechna volani
import http from 'node:http';
import { appendFileSync } from 'node:fs';

const PORT = Number(process.env.FAKE_GOPAY_PORT ?? 3999);
const LOG = new URL(process.env.FAKE_GOPAY_LOG ?? '../logs/fake-gopay.jsonl', import.meta.url);
const payments = new Map();
const calls = [];
let seq = 3000000000;

const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const body = await readBody(req);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const entry = { t: new Date().toISOString(), method: req.method, path: url.pathname, body: body.slice(0, 2000) };
  if (!url.pathname.startsWith('/_ctl')) { calls.push(entry); appendFileSync(LOG, JSON.stringify(entry) + '\n'); }
  let m;
  if (req.method === 'POST' && url.pathname === '/api/oauth2/token') return send(res, 200, { access_token: 'fake-token', token_type: 'bearer', expires_in: 1800 });
  if (req.method === 'POST' && url.pathname === '/api/payments/payment') {
    const p = JSON.parse(body || '{}');
    const id = String(++seq);
    payments.set(id, { id, state: 'CREATED', amount: p.amount, currency: p.currency, order_number: p.order_number, notification_url: p.callback?.notification_url, refunds: [] });
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
    p.refunds.push(amount);
    p.state = p.refunds.reduce((a, b) => a + b, 0) >= p.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    return send(res, 200, { id: Number(p.id), result: 'FINISHED' });
  }
  if ((m = url.pathname.match(/^\/_ctl\/(\d+)$/)) && req.method === 'POST') {
    const p = payments.get(m[1]);
    if (!p) return send(res, 404, { error: 'unknown' });
    const c = JSON.parse(body || '{}');
    if (c.state) p.state = c.state;
    if (c.amount !== undefined) p.amount = c.amount;
    return send(res, 200, p);
  }
  if (url.pathname === '/_ctl/payments') return send(res, 200, [...payments.values()]);
  if (url.pathname === '/_ctl/log') return send(res, 200, calls);
  send(res, 404, { error: 'not simulated', path: url.pathname });
}).listen(PORT, () => console.log(`fake-gopay on ${PORT}`));
