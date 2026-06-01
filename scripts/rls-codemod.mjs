#!/usr/bin/env node
/**
 * RLS Vlna B codemod — obalí route handlery do RLS kontextu + přepne pool na rls-pool db().
 *
 * Použití:
 *   node scripts/rls-codemod.mjs <domain> [--apply]
 *   node scripts/rls-codemod.mjs admin            # DRY-RUN (jen report)
 *   node scripts/rls-codemod.mjs admin --apply    # zapíše změny
 *
 * Domény → wrapper:
 *   buyer → runAsUser     (@/lib/auth),        preamble: x-user-id header
 *   admin → runAsPromoter (@/lib/admin-auth),  preamble: await requirePromoter(req)
 *
 * Transformuje JEN soubory s jednoznačným vzorem (pool pattern + preamble v KAŽDÉM
 * handleru); ostatní HLÁSÍ jako SKIP (manuál). Konzervativní.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DOMAIN = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!DOMAIN) { console.error('Usage: rls-codemod.mjs <domain> [--apply]'); process.exit(1); }

// preamble: vrací RegExp matchující auth-preamble na začátku těla handleru;
// capture group 2 = jméno proměnné (→ param callbacku). removeImport: import k odstranění.
const WRAP = {
  buyer: {
    fn: 'runAsUser',
    imp: "import { runAsUser } from '@/lib/auth';",
    preamble: (req) => new RegExp(`^\\s*const (\\w+) = ${req}\\.headers\\.get\\('x-user-id'\\);\\s*\\r?\\n\\s*if \\(!\\w+\\) return [^\\n]*40[13][^\\n]*;\\s*\\r?\\n`),
    removeImport: null,
  },
  admin: {
    fn: 'runAsPromoter',
    imp: "import { runAsPromoter } from '@/lib/admin-auth';",
    preamble: (req) => new RegExp(`^\\s*const (\\w+) = await requirePromoter\\(${req}\\);\\s*\\r?\\n\\s*if \\(!\\w+\\) return [^\\n]*40[13][^\\n]*;\\s*\\r?\\n`),
    removeImport: /import \{ requirePromoter \} from '@\/lib\/admin-auth';\r?\n/,
  },
};
const cfg = WRAP[DOMAIN];
if (!cfg) { console.error(`Nepodporovaná doména: ${DOMAIN}`); process.exit(1); }

const ROOT = join(process.cwd(), 'nextjs-boilerplate', 'src', 'app', 'api', DOMAIN);

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (e === 'route.ts') acc.push(p);
  }
  return acc;
}

function matchBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

let transformed = 0, skipped = 0;
const skips = [];

for (const file of walk(ROOT)) {
  let src = readFileSync(file, 'utf8');
  const orig = src;
  const rel = file.split('api' + (process.platform === 'win32' ? '\\' : '/'))[1];

  const hasPoolFn = /let pool: Pool \| null = null;[\s\S]*?return pool;[\s\S]*?\}/.test(src);
  const hasConstPool = /const pool = new Pool\(\{ connectionString: process\.env\.DATABASE_URL \}\);/.test(src);
  if (!hasPoolFn && !hasConstPool) { skips.push(`${rel} — nezná pool pattern`); skipped++; continue; }

  const handlerRe = /export async function (GET|POST|PUT|PATCH|DELETE)\s*\(\s*(\w+)\s*:[^)]*\)\s*:\s*Promise<[^>]+>\s*\{/g;
  const handlers = [...src.matchAll(handlerRe)];
  if (handlers.length === 0) { skips.push(`${rel} — žádný handler`); skipped++; continue; }

  // každý handler musí mít preamble; jinak SKIP
  let allOk = true;
  for (const h of handlers) {
    const body = src.slice(h.index + h[0].length - 1 + 1, matchBrace(src, h.index + h[0].length - 1));
    if (!cfg.preamble(h[2]).test(body)) { allOk = false; break; }
  }
  if (!allOk) { skips.push(`${rel} — handler bez ${DOMAIN} preamble`); skipped++; continue; }

  // transformace od konce
  for (const h of [...handlers].reverse()) {
    const reqName = h[2];
    const bodyStart = h.index + h[0].length - 1;
    const bodyEnd = matchBrace(src, bodyStart);
    let body = src.slice(bodyStart + 1, bodyEnd);
    const m = body.match(cfg.preamble(reqName));
    const uvar = m[1];
    body = body.replace(cfg.preamble(reqName), '');
    const wrapped = `\n  return ${cfg.fn}(${reqName}, async (${uvar}) => {\n${body}\n  });\n`;
    src = src.slice(0, bodyStart + 1) + wrapped + src.slice(bodyEnd);
  }

  // importy + pool swap (CRLF-tolerantní)
  if (cfg.removeImport) src = src.replace(cfg.removeImport, '');
  src = src.replace(/import \{ Pool \} from 'pg';\r?\n/, '');
  src = src.replace(/let pool: Pool \| null = null;[\s\S]*?return pool;[\s\S]*?\}\r?\n/, '');
  src = src.replace(/const pool = new Pool\(\{ connectionString: process\.env\.DATABASE_URL \}\);\r?\n/, '');
  src = src.replace(/\bpool\.query\b/g, 'db().query');
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const poolTypeImport = /\bPool\b/.test(src) ? `import type { Pool } from 'pg';${nl}` : '';
  const importLine = `import { db } from '@/lib/db/rls-pool';${nl}${cfg.imp}${nl}${poolTypeImport}`;
  src = src.replace(/^(import [^\n]*\n)/m, `$1${importLine}`);

  if (src !== orig) {
    transformed++;
    if (APPLY) writeFileSync(file, src);
    else console.log(`WOULD TRANSFORM: ${rel} (${handlers.length} handler/ů)`);
  }
}

console.log(`\n=== ${APPLY ? 'APLIKOVÁNO' : 'DRY-RUN'} doména=${DOMAIN}: transformováno=${transformed}, skip=${skipped} ===`);
if (skips.length) { console.log('SKIPS (manuál):'); skips.forEach((s) => console.log('  - ' + s)); }
