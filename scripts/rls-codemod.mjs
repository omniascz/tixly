#!/usr/bin/env node
/**
 * RLS Vlna B codemod — obalí route handlery do RLS kontextu + přepne pool na rls-pool db().
 *
 * Použití:
 *   node scripts/rls-codemod.mjs <domain> [--apply]
 *   node scripts/rls-codemod.mjs buyer            # DRY-RUN (jen report)
 *   node scripts/rls-codemod.mjs buyer --apply    # zapíše změny
 *
 * Domény → wrapper:
 *   buyer    → runAsUser        (@/lib/auth),         ctx param: userId,  preamble: x-user-id
 *
 * Transformuje JEN soubory s jednoznačným vzorem; ostatní HLÁSÍ jako SKIP (manuál).
 * Konzervativní: když si není jistý, nesahá na to.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DOMAIN = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!DOMAIN) { console.error('Usage: rls-codemod.mjs <domain> [--apply]'); process.exit(1); }

const WRAP = {
  buyer: { fn: 'runAsUser', imp: "import { runAsUser } from '@/lib/auth';", param: 'userId' },
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

// Najde tělo funkce od indexu '{' (po hlavičce) a vrátí index odpovídající '}'.
function matchBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

let transformed = 0, skipped = 0;
const skips = [];

for (const file of walk(ROOT)) {
  let src = readFileSync(file, 'utf8');
  const orig = src;
  const rel = file.split('api' + (process.platform === 'win32' ? '\\' : '/'))[1];

  // 1) musí mít lokální pool pattern (jinak SKIP — neznámý tvar)
  const hasPoolFn = /let pool: Pool \| null = null;\s*\nfunction db\(\): Pool \{[\s\S]*?return pool;\s*\n\}/.test(src);
  const hasConstPool = /const pool = new Pool\(\{ connectionString: process\.env\.DATABASE_URL \}\);/.test(src);
  if (!hasPoolFn && !hasConstPool) { skips.push(`${rel} — nezná pool pattern`); skipped++; continue; }

  // 2) každý handler musí mít x-user-id preamble; jinak SKIP celý soubor (nejednoznačné)
  const handlerRe = /export async function (GET|POST|PUT|PATCH|DELETE)\s*\(\s*(\w+)\s*:[^)]*\)\s*:\s*Promise<[^>]+>\s*\{/g;
  const handlers = [...src.matchAll(handlerRe)];
  if (handlers.length === 0) { skips.push(`${rel} — žádný handler`); skipped++; continue; }

  let allOk = true;
  for (const h of handlers) {
    const reqName = h[2];
    const bodyStart = h.index + h[0].length - 1; // index '{'
    const bodyEnd = matchBrace(src, bodyStart);
    const body = src.slice(bodyStart + 1, bodyEnd);
    const pre = new RegExp(`^\\s*const (\\w+) = ${reqName}\\.headers\\.get\\('x-user-id'\\);\\s*\\n\\s*if \\(![\\w]+\\) return [^\\n]*40[13][^\\n]*;`);
    if (!pre.test(body)) { allOk = false; break; }
  }
  if (!allOk) { skips.push(`${rel} — handler bez x-user-id preamble`); skipped++; continue; }

  // 3) transformace (od konce, ať indexy sedí)
  for (const h of [...handlers].reverse()) {
    const reqName = h[2];
    const bodyStart = h.index + h[0].length - 1;
    const bodyEnd = matchBrace(src, bodyStart);
    let body = src.slice(bodyStart + 1, bodyEnd);
    const pre = new RegExp(`^(\\s*)const (\\w+) = ${reqName}\\.headers\\.get\\('x-user-id'\\);\\s*\\n\\s*if \\(![\\w]+\\) return [^\\n]*40[13][^\\n]*;\\s*\\n`);
    const m = body.match(pre);
    const uvar = m[2];
    body = body.replace(pre, ''); // odstraň preamble
    const wrapped = `\n  return ${cfg.fn}(${reqName}, async (${uvar}) => {\n${body}\n  });\n`;
    src = src.slice(0, bodyStart + 1) + wrapped + src.slice(bodyEnd);
  }

  // 4) importy + pool swap (CRLF-tolerantní — soubory mají \r\n)
  src = src.replace(/import \{ Pool \} from 'pg';\r?\n/, '');
  src = src.replace(/let pool: Pool \| null = null;[\s\S]*?return pool;[\s\S]*?\}\r?\n/, '');
  src = src.replace(/const pool = new Pool\(\{ connectionString: process\.env\.DATABASE_URL \}\);\r?\n/, '');
  src = src.replace(/\bpool\.query\b/g, 'db().query');
  // přidej importy za první import řádek
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  // pokud po odstranění value-importu zůstává type-only použití Pool (např. Pool['query']),
  // doplň type-only import, ať tsc nepadá na "Cannot find name 'Pool'".
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
