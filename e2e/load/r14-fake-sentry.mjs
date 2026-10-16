/**
 * Kolo 14 / krok 3 — simulátor Sentry: přijímá obálky (POST /api/<projekt>/envelope/), ukládá je (JSONL) a na
 * GET /_events vrací přijaté události (typ, zpráva / výjimka, tagy, request). Jen localhost.
 *   node load/r14-fake-sentry.mjs <port> <výstup.jsonl>
 * Kolo 19: SDK 11 posílá spany v položkách typu „span" (span streaming) — ty jsou v /_events a ve výstupu také
 * (pole item_type); celá dekódovaná obálka (hlavička obálky + všechny položky vč. session/client_report) se navíc
 * ukládá do <výstup>.raw.jsonl pro kontrolu osobních údajů.
 */
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { gunzipSync, inflateSync } from 'node:zlib';

const [port = '3995', out = 'sentry-envelopes.jsonl'] = process.argv.slice(2);
const events = [];
createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/_events') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(events));
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let buf = Buffer.concat(chunks);
    const enc = req.headers['content-encoding'];
    if (enc === 'gzip') buf = gunzipSync(buf); else if (enc === 'deflate') buf = inflateSync(buf);
    const text = buf.toString('utf8');
    appendFileSync(`${out}.raw.jsonl`, `${JSON.stringify({ t: new Date().toISOString(), method: req.method, url: req.url, body: text })}\n`);
    const lines = text.split('\n').filter(Boolean);
    for (let i = 1; i < lines.length; i += 2) {
      try {
        const header = JSON.parse(lines[i]); const item = JSON.parse(lines[i + 1] ?? '{}');
        if (header.type === 'event' || header.type === 'transaction') {
          const e = { type: header.type, message: item.message, exception: item.exception?.values?.map((v) => `${v.type}: ${v.value}`), tags: item.tags, request: item.request, user: item.user, extra: item.extra, contexts: item.contexts };
          events.push(e);
          appendFileSync(out, `${JSON.stringify({ t: new Date().toISOString(), url: req.url, raw: item })}\n`);
        } else if (header.type === 'span') {
          events.push({ type: 'span', spans: (item.items ?? []).map((s) => ({ name: s.name, is_segment: s.is_segment, attributes: s.attributes })) });
          appendFileSync(out, `${JSON.stringify({ t: new Date().toISOString(), url: req.url, item_type: 'span', raw: item })}\n`);
        }
      } catch { /* jiné položky obálky */ }
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
}).listen(Number(port), '127.0.0.1', () => console.log(`fake sentry :${port}`));
