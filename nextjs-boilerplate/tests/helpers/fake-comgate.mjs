// Simulátor ComGate REST API v2.0 (kolo 7) — PODLE OFICIÁLNÍ DOKUMENTACE https://apidoc.comgate.cz/en/api/rest/
// (staženo 2026-10-04), ne podle našeho klienta: cesty, názvy polí a odpovědi jsou z dokumentace, aby test
// odhalil, když klient volá něco, co skutečná brána nezná.
//
//   POST /v2.0/payment.json                 {test,country,price,curr,label(1–16),refId,method,email,…}
//                                           -> 201 {code:0,message:'OK',transId,redirect}
//   GET  /v2.0/payment/transId/{transId}.json -> 200 {code:0,message,test,price(string),curr,label,refId,transId,status,email}
//   POST /v2.0/refund.json                  {transId,amount,test,refId?} -> 200 {code:0,message:'OK'}
//   Autorizace: Authorization: Basic base64(merchant:secret). Jiná cesta -> 404.
//   Stavy: PENDING | AUTHORIZED | PAID | CANCELLED (stavy-plateb).
//
// Řízení z testu: POST /_ctl/status/{transId} {"status":"PAID"} · POST /_ctl/refundmode/{transId} {"mode":"ok|error|timeout"}
//                 GET /_ctl/payments · GET /_ctl/calls
import http from 'node:http';

export function startFakeComGate({ merchant = 'fix-merchant', secret = 'fix-secret' } = {}) {
  const payments = new Map();
  const refundMode = new Map();
  const calls = [];
  const hanging = new Set();
  let seq = 1000;
  const expectedAuth = `Basic ${Buffer.from(`${merchant}:${secret}`).toString('base64')}`;

  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { __invalidJson: raw }; }
    calls.push({ method: req.method, path: p, body });

    if (p.startsWith('/_ctl/')) {
      const [, , what, id] = p.split('/');
      if (what === 'status' && payments.has(id)) { payments.get(id).status = body.status; return send(200, { ok: true }); }
      if (what === 'refundmode') { refundMode.set(id, body.mode); return send(200, { ok: true }); }
      if (what === 'payments') return send(200, [...payments.values()]);
      if (what === 'calls') return send(200, calls);
      return send(404, { error: 'ctl' });
    }

    if (req.headers.authorization !== expectedAuth) return send(401, { code: 1400, message: 'Unauthorized' });

    if (req.method === 'POST' && p === '/v2.0/payment.json') {
      const missing = ['price', 'curr', 'label', 'refId', 'method', 'email'].filter((k) => body[k] === undefined || body[k] === '');
      if (missing.length) return send(400, { code: 1100, message: `Missing: ${missing.join(',')}` });
      if (!Number.isInteger(body.price) || body.price <= 0) return send(400, { code: 1100, message: 'Invalid price' });
      if (typeof body.label !== 'string' || body.label.length < 1 || body.label.length > 16) return send(400, { code: 1100, message: 'Invalid label (1-16)' });
      if (!/^[A-Z]{3}$/.test(String(body.curr))) return send(400, { code: 1100, message: 'Invalid curr' });
      const transId = `FAKE-${String(seq++).padStart(4, '0')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      payments.set(transId, { transId, status: 'PENDING', price: body.price, curr: body.curr, label: body.label, refId: String(body.refId), email: body.email, test: body.test === true, request: body, refunded: 0 });
      return send(201, { code: 0, message: 'OK', transId, redirect: `https://payments.comgate.cz/client/instructions/index?id=${transId}` });
    }

    const st = /^\/v2\.0\/payment\/transId\/([^/]+)\.json$/.exec(p);
    if (req.method === 'GET' && st) {
      const pay = payments.get(decodeURIComponent(st[1]));
      if (!pay) return send(404, { code: 1400, message: 'Payment not found' });
      return send(200, { code: 0, message: 'OK', test: String(pay.test), price: String(pay.price), curr: pay.curr, label: pay.label, refId: pay.refId, transId: pay.transId, status: pay.status, email: pay.email });
    }

    if (req.method === 'POST' && p === '/v2.0/refund.json') {
      const pay = payments.get(String(body.transId ?? ''));
      const mode = refundMode.get(String(body.transId ?? '')) ?? 'ok';
      if (mode === 'timeout') { hanging.add(res); return undefined; }
      if (mode === 'error') return send(500, { code: 1500, message: 'Server Error (simulace)' });
      if (!pay) return send(400, { code: 1400, message: 'Payment not found' });
      if (pay.status !== 'PAID') return send(400, { code: 1400, message: 'Payment is not paid' });
      if (!Number.isInteger(body.amount) || body.amount <= 0 || pay.refunded + body.amount > pay.price) return send(400, { code: 1100, message: 'Invalid amount' });
      pay.refunded += body.amount;
      return send(200, { code: 0, message: 'OK' });
    }

    return send(404, { code: 1400, message: `Unknown endpoint ${req.method} ${p}` });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({
        base,
        apiBaseUrl: `${base}/v2.0`,
        merchant, secret, payments, calls,
        setStatus: (id, status) => { payments.get(id).status = status; },
        setRefundMode: (id, mode) => refundMode.set(id, mode),
        close: () => new Promise((r) => { for (const h of hanging) h.destroy(); server.closeAllConnections?.(); server.close(() => r(undefined)); }),
      });
    });
  });
}
