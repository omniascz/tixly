// Simulátor Resend pro testy stagingu (kolo 10 / krok 4). NENÍ to reálný Resend, nic nedoručuje.
//
// Tixly posílá e-maily dvěma cestami a obě vedou do Resendu:
//   - SMTP (src/lib/email/mailer.ts; na stagingu SMTP_HOST=smtp.resend.com, user=resend, pass=re_…)
//   - HTTP API (src/lib/notifications/platform-notify.ts; POST {RESEND_API_BASE_URL}/emails)
// Simulátor přijímá obojí a obojí ukládá do jednoho seznamu odeslaných zpráv, který vrací jako Resend API:
//
//   POST /emails          {from,to,subject,…}  → {id}            (Authorization: Bearer re_… povinné)
//   GET  /emails          → {object:'list', has_more:false, data:[{id,from,to:[…],subject,created_at,last_event}]}
//   GET  /emails/:id      → zpráva
//   SMTP                  EHLO/HELO, AUTH PLAIN|LOGIN (cokoli), MAIL FROM, RCPT TO, DATA, RSET, NOOP, QUIT
//   Řízení:  POST /_ctl/reset  (vyprázdní seznam)
//
//   FAKE_RESEND_PORT (3996), FAKE_RESEND_SMTP_PORT (2526)
import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'node:crypto';

const HTTP_PORT = Number(process.env.FAKE_RESEND_PORT ?? 3996);
const SMTP_PORT = Number(process.env.FAKE_RESEND_SMTP_PORT ?? 2526);
const sent = [];

function store({ from, to, subject, via }) {
  const msg = {
    id: randomUUID(),
    object: 'email',
    from: from ?? '',
    to: (Array.isArray(to) ? to : [to]).filter(Boolean).map(String),
    subject: subject ?? '',
    created_at: new Date().toISOString(),
    last_event: 'delivered',
    via,
  };
  sent.unshift(msg);
  return msg;
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/_ctl/reset') { sent.length = 0; return json(res, 200, { ok: true }); }
    const auth = req.headers.authorization ?? '';
    if (!/^Bearer re_\S+/.test(auth)) return json(res, 401, { name: 'missing_api_key', message: 'Missing API key' });
    if (req.method === 'POST' && url.pathname === '/emails') {
      let b;
      try { b = JSON.parse(raw || '{}'); } catch { return json(res, 422, { name: 'invalid_json' }); }
      if (!b.from || !b.to || !b.subject) return json(res, 422, { name: 'validation_error', message: 'from, to, subject required' });
      return json(res, 200, { id: store({ ...b, via: 'api' }).id });
    }
    if (req.method === 'GET' && url.pathname === '/emails') {
      return json(res, 200, { object: 'list', has_more: false, data: sent.map(({ via: _via, ...m }) => m) });
    }
    const one = /^\/emails\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'GET' && one) {
      const m = sent.find((x) => x.id === one[1]);
      return m ? json(res, 200, m) : json(res, 404, { name: 'not_found' });
    }
    return json(res, 404, { name: 'not_found' });
  });
}).listen(HTTP_PORT, () => console.log(`[fake-resend] HTTP :${HTTP_PORT}`));

// Minimální SMTP — tolik, kolik potřebuje nodemailer (bez STARTTLS: neinzerujeme ho, nodemailer pak jede čistě).
net.createServer((sock) => {
  sock.setEncoding('utf8');
  let buf = '';
  let state = 'cmd';
  let env = { from: '', to: [] };
  let data = '';
  let authStep = 0;
  const say = (s) => sock.write(s + '\r\n');
  say('220 fake-resend ESMTP');
  sock.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (state === 'data') {
        if (line === '.') {
          // hlavičky + rozbalení přeložených řádků (dlouhý Subject nodemailer zalomí)
          const head = (data.split('\r\n\r\n')[0] ?? '').replace(/\r\n[ \t]+/g, ' ');
          const hdr = (n) => (new RegExp('^' + n + ':\\s*(.*)$', 'im').exec(head)?.[1] ?? '').trim();
          const subject = decodeMime(hdr('Subject'));
          store({ from: hdr('From') || env.from, to: env.to, subject, via: 'smtp' });
          state = 'cmd'; data = ''; env = { from: '', to: [] };
          say('250 OK queued');
        } else {
          data += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
        }
        continue;
      }
      if (state === 'auth') {
        authStep -= 1;
        if (authStep > 0) say('334 UGFzc3dvcmQ6');
        else { state = 'cmd'; say('235 Authentication successful'); }
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') { say('250-fake-resend'); say('250-AUTH PLAIN LOGIN'); say('250 8BITMIME'); }
      else if (cmd === 'HELO') say('250 fake-resend');
      else if (cmd === 'AUTH') {
        const parts = line.split(' ');
        if ((parts[1] ?? '').toUpperCase() === 'PLAIN' && parts[2]) say('235 Authentication successful');
        else if ((parts[1] ?? '').toUpperCase() === 'PLAIN') { state = 'auth'; authStep = 1; say('334 '); }
        else { state = 'auth'; authStep = parts[2] ? 1 : 2; say(parts[2] ? '334 UGFzc3dvcmQ6' : '334 VXNlcm5hbWU6'); }
      }
      else if (cmd === 'MAIL') { env.from = (/<([^>]*)>/.exec(line)?.[1] ?? ''); say('250 OK'); }
      else if (cmd === 'RCPT') { env.to.push(/<([^>]*)>/.exec(line)?.[1] ?? ''); say('250 OK'); }
      else if (cmd === 'DATA') { state = 'data'; say('354 End data with <CR><LF>.<CR><LF>'); }
      else if (cmd === 'RSET') { env = { from: '', to: [] }; say('250 OK'); }
      else if (cmd === 'NOOP') say('250 OK');
      else if (cmd === 'QUIT') { say('221 Bye'); sock.end(); }
      else say('502 Command not implemented');
    }
  });
  sock.on('error', () => {});
}).listen(SMTP_PORT, () => console.log(`[fake-resend] SMTP :${SMTP_PORT}`));

// Subject může přijít jako MIME encoded-word (=?UTF-8?B?…?= / =?UTF-8?Q?…?=), i rozdělený do více slov.
function decodeMime(s) {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=\s*/g, (_m, _cs, enc, txt) => {
    if (enc.toUpperCase() === 'B') return Buffer.from(txt, 'base64').toString('utf8');
    const bytes = txt.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(bytes, 'latin1').toString('utf8');
  });
}
