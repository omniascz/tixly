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
// Každá doména = pole variant. Per soubor se vybere první varianta, jejíž preamble
// matchuje VŠECHNY handlery. preamble capture group 1 = jméno proměnné (param callbacku).
const REQUIRE_PROMOTER_IMPORT = /import \{ requirePromoter \} from '@\/lib\/admin-auth';\r?\n/;
const WRAP = {
  buyer: [
    {
      fn: 'runAsUser',
      imp: "import { runAsUser } from '@/lib/auth';",
      preamble: (req) => new RegExp(`^\\s*const (\\w+) = ${req}\\.headers\\.get\\('x-user-id'\\);\\s*\\r?\\n\\s*if \\(!\\w+\\) return [^\\n]*40[13][^\\n]*;\\s*\\r?\\n`),
      removeImport: null,
    },
  ],
  admin: [
    {
      // jednoduchý: if (!promoter) return 401;
      fn: 'runAsPromoter',
      imp: "import { runAsPromoter } from '@/lib/admin-auth';",
      preamble: (req) => new RegExp(`^\\s*const (\\w+) = await requirePromoter\\(${req}\\);\\s*\\r?\\n\\s*if \\(!\\w+\\) return [^\\n]*40[13][^\\n]*;\\s*\\r?\\n`),
      removeImport: REQUIRE_PROMOTER_IMPORT,
    },
    {
      // active: if (!promoter || promoter.status !== 'active') { return ...; }
      fn: 'runAsActivePromoter',
      imp: "import { runAsActivePromoter } from '@/lib/admin-auth';",
      preamble: (req) => new RegExp(`^\\s*const (\\w+) = await requirePromoter\\(${req}\\);\\s*\\r?\\n\\s*if \\(!\\1 \\|\\| \\1\\.status !== 'active'\\) \\{\\s*\\r?\\n\\s*return [\\s\\S]*?;\\s*\\r?\\n\\s*\\}\\s*\\r?\\n`),
      removeImport: REQUIRE_PROMOTER_IMPORT,
    },
  ],
  platform: [
    {
      // blok: if (!admin) { return ...; }
      fn: 'runAsPlatformAdmin',
      imp: "import { runAsPlatformAdmin } from '@/lib/platform-auth';",
      preamble: (req) => new RegExp(`^\\s*const (\\w+) = await requirePlatformAdmin\\(${req}\\);\\s*\\r?\\n\\s*if \\(!\\1\\) \\{\\s*\\r?\\n\\s*return [\\s\\S]*?;\\s*\\r?\\n\\s*\\}\\s*\\r?\\n`),
      removeImport: /import \{ requirePlatformAdmin \} from '@\/lib\/platform-auth';\r?\n/,
    },
    {
      // single-line: if (!admin) return ...;
      fn: 'runAsPlatformAdmin',
      imp: "import { runAsPlatformAdmin } from '@/lib/platform-auth';",
      preamble: (req) => new RegExp(`^\\s*const (\\w+) = await requirePlatformAdmin\\(${req}\\);\\s*\\r?\\n\\s*if \\(!\\w+\\) return [^\\n]*40[13][^\\n]*;\\s*\\r?\\n`),
      removeImport: /import \{ requirePlatformAdmin \} from '@\/lib\/platform-auth';\r?\n/,
    },
  ],
  internal: [
    {
      // service kontext: obalí CELÉ tělo (token-check zůstane uvnitř), bez req argumentu
      fn: 'runWithServiceContext',
      imp: "import { db, runWithServiceContext } from '@/lib/db/rls-pool';",
      ownDb: true, // imp už obsahuje db → nepřidávat zvlášť
      preamble: null, // žádná preamble — wrap-whole-body
      reqArg: false,
      removeImport: null,
    },
  ],
};
// service domény (trusted server operace: tvorba/aktualizace objednávek, mock platby) → service kontext
for (const d of [
  'checkout', 'payments',
  'mock-gopay', 'mock-bnpl', 'mock-przelewy24', 'mock-wero',
  'mock-subscription', 'mock-voucher', 'mock-benefit', 'mock-transit',
]) {
  WRAP[d] = WRAP.internal;
}
const variants = WRAP[DOMAIN];
if (!variants) { console.error(`Nepodporovaná doména: ${DOMAIN}`); process.exit(1); }

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

  // vyber variantu, jejíž preamble matchuje VŠECHNY handlery
  const bodyOf = (h) => src.slice(h.index + h[0].length, matchBrace(src, h.index + h[0].length - 1));
  const cfg = variants.find((v) => handlers.every((h) => (v.preamble ? v.preamble(h[2]).test(bodyOf(h)) : true)));
  if (!cfg) { skips.push(`${rel} — handler bez známé preamble`); skipped++; continue; }

  // transformace od konce
  for (const h of [...handlers].reverse()) {
    const reqName = h[2];
    const bodyStart = h.index + h[0].length - 1;
    const bodyEnd = matchBrace(src, bodyStart);
    let body = src.slice(bodyStart + 1, bodyEnd);
    let head;
    if (!cfg.preamble) {
      // wrap-whole-body (service): bez req argumentu, bez odstranění preamble
      head = `${cfg.fn}(async () => {`;
    } else {
      const uvar = body.match(cfg.preamble(reqName))[1];
      body = body.replace(cfg.preamble(reqName), '');
      const param = new RegExp(`\\b${uvar}\\b`).test(body) ? uvar : `_${uvar}`;
      head = `${cfg.fn}(${reqName}, async (${param}) => {`;
    }
    const wrapped = `\n  return ${head}\n${body}\n  });\n`;
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
  const dbImport = cfg.ownDb ? '' : `import { db } from '@/lib/db/rls-pool';${nl}`;
  const importLine = `${dbImport}${cfg.imp}${nl}${poolTypeImport}`;
  src = src.replace(/^(import [^\n]*\n)/m, `$1${importLine}`);

  if (src !== orig) {
    transformed++;
    if (APPLY) writeFileSync(file, src);
    else console.log(`WOULD TRANSFORM: ${rel} (${handlers.length} handler/ů)`);
  }
}

console.log(`\n=== ${APPLY ? 'APLIKOVÁNO' : 'DRY-RUN'} doména=${DOMAIN}: transformováno=${transformed}, skip=${skipped} ===`);
if (skips.length) { console.log('SKIPS (manuál):'); skips.forEach((s) => console.log('  - ' + s)); }
