// Kolo 16 / krok 3 — přehrání zachycených zpráv přes nodemailer 8.0.11 a 10.0.16 do Mailpitu a porovnání surového MIME.
//   node replay-compare.mjs <adresář zachycených JSON> <adresář s node_modules nodemailer 8> <… 10> <výstup.md>
// Normalizace: hlavičky Message-ID a Date vypuštěny; hranice MIME (boundary) nahrazeny pořadím výskytu.
// Navíc: dekódované části (text/html/přílohy) porovnány podle SHA-256.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [capDir, dir8, dir10, outFile] = process.argv.slice(2);
const MAILPIT = process.env.MAILPIT ?? 'http://localhost:58225';
const SMTP = { host: 'localhost', port: Number(process.env.SMTP_PORT ?? 51225), secure: false, tls: { rejectUnauthorized: false } };
const load = (d) => createRequire(join(d, 'package.json'))('nodemailer');
const nm = { '8': load(dir8), '10': load(dir10) };
const ver = (d) => JSON.parse(readFileSync(join(d, 'node_modules', 'nodemailer', 'package.json'), 'utf8')).version;
const de = (v) => (v && typeof v === 'object' && '__buffer' in v ? Buffer.from(v.__buffer, 'base64') : Array.isArray(v) ? v.map(de) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, de(x)])) : v);
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);

function normalize(raw) {
  const [head, ...rest] = raw.split(/\r?\n\r?\n/);
  const headers = head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).filter((l) => !/^(Message-ID|Date|Received):/i.test(l)) /* Received přidává simulátor (čas přijetí), ne nodemailer */;
  let s = [headers.join('\n'), ...rest].join('\n\n').replace(/\r\n/g, '\n');
  const bounds = [...new Set([...s.matchAll(/boundary="?([^";\s]+)"?/gi)].map((m) => m[1]))];
  bounds.forEach((b, i) => { s = s.split(b).join(`__BOUNDARY_${i}__`); });
  return s;
}
async function send(v, data) {
  const t = nm[v].createTransport(SMTP);
  const info = await t.sendMail(data);
  t.close();
  const id = /queued as ([A-Za-z0-9]+)/.exec(info.response ?? '')?.[1];
  if (!id) throw new Error(`Mailpit nevrátil ID: ${info.response}`);
  const raw = await (await fetch(`${MAILPIT}/api/v1/message/${id}/raw`)).text();
  const msg = await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
  const parts = { html: sha(Buffer.from(msg.HTML ?? '')), text: sha(Buffer.from(msg.Text ?? '')), attachments: [] };
  for (const a of msg.Attachments ?? []) {
    const b = Buffer.from(await (await fetch(`${MAILPIT}/api/v1/message/${id}/part/${a.PartID}`)).arrayBuffer());
    parts.attachments.push(`${a.FileName}:${a.ContentType}:${b.length}:${sha(b)}`);
  }
  return { raw, parts };
}

const files = readdirSync(capDir).filter((f) => f.endsWith('.json')).sort();
const rows = []; let same = 0;
for (const f of files) {
  const data = de(JSON.parse(readFileSync(join(capDir, f), 'utf8')).data);
  const a = await send('8', data); const b = await send('10', data);
  const na = normalize(a.raw); const nb = normalize(b.raw);
  const partsSame = JSON.stringify(a.parts) === JSON.stringify(b.parts);
  const rawSame = na === nb;
  if (rawSame && partsSame) same++;
  let firstDiff = '';
  if (!rawSame) { const la = na.split('\n'); const lb = nb.split('\n'); const i = la.findIndex((l, k) => l !== lb[k]); firstDiff = `řádek ${i + 1}: «${(la[i] ?? '').slice(0, 120)}» vs «${(lb[i] ?? '').slice(0, 120)}»`; }
  rows.push(`| ${f} | ${String(data.subject ?? '').slice(0, 60).replace(/\|/g, '/')} | ${a.parts.attachments.length} | ${rawSame ? 'shodný' : 'ROZDÍL'} | ${partsSame ? 'shodné' : 'ROZDÍL'} | ${firstDiff.replace(/\|/g, '/')} |`);
  if (!rawSame) { writeFileSync(join(capDir, '..', `diff-${f}.v8.eml`), na); writeFileSync(join(capDir, '..', `diff-${f}.v10.eml`), nb); }
}
const out = [`# Přehrání ${files.length} zachycených zpráv: nodemailer ${ver(dir8)} vs ${ver(dir10)} (SMTP → Mailpit)`, '',
  `Shodných (surový MIME bez Message-ID/Date (a Received od simulátoru) s normalizovanými hranicemi + dekódované části): **${same}/${files.length}**`, '',
  '| soubor | předmět | příloh | surový MIME | části (SHA-256) | první rozdíl |', '|---|---|---|---|---|---|', ...rows].join('\n');
writeFileSync(outFile, out); console.log(out.split('\n').slice(0, 3).join('\n'));
