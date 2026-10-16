// Kolo 19 — před commitem: v logs/r19 nahradí hodnoty tajemství z nextjs-boilerplate/fix.app.env a JWT maskou.
// Hodnoty se nikam nevypisují; vypíše jen názvy souborů a počty náhrad.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const env = Object.fromEntries(readFileSync(new URL('../../nextjs-boilerplate/fix.app.env', import.meta.url), 'utf8')
  .split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]));
const secrets = ['JWT_SECRET', 'ENCRYPTION_KEY', 'INTERNAL_SERVICE_TOKEN', 'CRON_SECRET', 'GOPAY_CLIENT_SECRET']
  .map((k) => [k, env[k]]).filter(([, v]) => v && v.length >= 8);
const JWT = /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g;
const dir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
for (const f of walk(dir).filter((p) => /\.(txt|jsonl|json|md)$/.test(p))) {
  let s = readFileSync(f, 'utf8'); let n = 0;
  for (const [k, v] of secrets) { const parts = s.split(v); if (parts.length > 1) { n += parts.length - 1; s = parts.join(`[${k} redigováno]`); } }
  s = s.replace(JWT, (m) => { n++; return `${m.slice(0, 4)}…[JWT redigováno]`; });
  if (n) { writeFileSync(f, s); console.log(`${f.slice(dir.length)}: ${n}`); }
}
