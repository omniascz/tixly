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
      // single-line: const userId = req.headers.get('x-user-id'); if (!userId) return 401;
      fn: 'runAsUser',
      imp: "import { runAsUser } from '@/lib/auth';",
      preamble: (req) => new RegExp(`^\\s*const (\\w+) = ${req}\\.headers\\.get\\('x-user-id'\\);\\s*\\r?\\n\\s*if \\(!\\w+\\) return [^\\n]*40[13][^\\n]*;\\s*\\r?\\n`),
      removeImport: null,
    },
    {
      // block: const userId = ...; if (!userId) { return ...; }
      fn: 'runAsUser',
      imp: "import { runAsUser } from '@/lib/auth';",
      preamble: (req) => new RegExp(`^\\s*const (\\w+) = ${req}\\.headers\\.get\\('x-user-id'\\);\\s*\\r?\\n\\s*if \\(!\\1\\) \\{\\s*\\r?\\n\\s*return [\\s\\S]*?;\\s*\\r?\\n\\s*\\}\\s*\\r?\\n`),
      removeImport: null,
    },
  ],
  admin: [
    {
      // jednoduchý single-line: if (!promoter) return 401;
      fn: 'runAsPromoter',
      imp: "import { runAsPromoter } from '@/lib/admin-auth';",
      preamble: (req) => new RegExp(`^\\s*const (\\w+) = await requirePromoter\\(${req}\\);\\s*\\r?\\n\\s*if \\(!\\w+\\) return [^\\n]*40[13][^\\n]*;\\s*\\r?\\n`),
      removeImport: REQUIRE_PROMOTER_IMPORT,
    },
    {
      // blok: if (!promoter) { return ...; }
      fn: 'runAsPromoter',
      imp: "import { runAsPromoter } from '@/lib/admin-auth';",
      preamble: (req) => new RegExp(`^\\s*const (\\w+) = await requirePromoter\\(${req}\\);\\s*\\r?\\n\\s*if \\(!\\1\\) \\{\\s*\\r?\\n\\s*return [\\s\\S]*?;\\s*\\r?\\n\\s*\\}\\s*\\r?\\n`),
      removeImport: REQUIRE_PROMOTER_IMPORT,
    },
    {
      // active: if (!promoter || promoter.status !== 'active') { return ...; }
      fn: 'runAsActivePromoter',
      imp: "import { runAsActivePromoter } from '@/lib/admin-auth';",
      preamble: (req) => new RegExp(`^\\s*const (\\w+) = await requirePromoter\\(${req}\\);\\s*\\r?\\n\\s*if \\(!\\1 \\|\\| \\1\\.status !== 'active'\\) \\{\\s*\\r?\\n\\s*return [\\s\\S]*?;\\s*\\r?\\n\\s*\\}\\s*\\r?\\n`),
      removeImport: REQUIRE_PROMOTER_IMPORT,
    },
    {
      // active + owner: if (!p || p.status !== 'active' || p.role !== 'owner') { return; }
      fn: 'runAsActivePromoterOwner',
      imp: "import { runAsActivePromoterOwner } from '@/lib/admin-auth';",
      preamble: (req) => new RegExp(`^\\s*const (\\w+) = await requirePromoter\\(${req}\\);\\s*\\r?\\n\\s*if \\(!\\1 \\|\\| \\1\\.status !== 'active' \\|\\| \\1\\.role !== 'owner'\\) \\{\\s*\\r?\\n\\s*return [\\s\\S]*?;\\s*\\r?\\n\\s*\\}\\s*\\r?\\n`),
      removeImport: REQUIRE_PROMOTER_IMPORT,
    },
    {
      // active + non-staff: if (!p || p.status !== 'active' || p.role === 'staff') { return; }
      fn: 'runAsActivePromoterNonStaff',
      imp: "import { runAsActivePromoterNonStaff } from '@/lib/admin-auth';",
      preamble: (req) => new RegExp(`^\\s*const (\\w+) = await requirePromoter\\(${req}\\);\\s*\\r?\\n\\s*if \\(!\\1 \\|\\| \\1\\.status !== 'active' \\|\\| \\1\\.role === 'staff'\\) \\{\\s*\\r?\\n\\s*return [\\s\\S]*?;\\s*\\r?\\n\\s*\\}\\s*\\r?\\n`),
      removeImport: REQUIRE_PROMOTER_IMPORT,
    },
    {
      // owner: if (!promoter || promoter.role !== 'owner') { return; }
      fn: 'runAsPromoterOwner',
      imp: "import { runAsPromoterOwner } from '@/lib/admin-auth';",
      preamble: (req) => new RegExp(`^\\s*const (\\w+) = await requirePromoter\\(${req}\\);\\s*\\r?\\n\\s*if \\(!\\1 \\|\\| \\1\\.role !== 'owner'\\) \\{\\s*\\r?\\n\\s*return [\\s\\S]*?;\\s*\\r?\\n\\s*\\}\\s*\\r?\\n`),
      removeImport: REQUIRE_PROMOTER_IMPORT,
    },
    {
      // non-staff: if (!promoter || promoter.role === 'staff') { return; }
      fn: 'runAsPromoterNonStaff',
      imp: "import { runAsPromoterNonStaff } from '@/lib/admin-auth';",
      preamble: (req) => new RegExp(`^\\s*const (\\w+) = await requirePromoter\\(${req}\\);\\s*\\r?\\n\\s*if \\(!\\1 \\|\\| \\1\\.role === 'staff'\\) \\{\\s*\\r?\\n\\s*return [\\s\\S]*?;\\s*\\r?\\n\\s*\\}\\s*\\r?\\n`),
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
// Cílené file-listy (bespoke skupiny) → service config, jen vyjmenované soubory.
// Bezpečnější než service fallback v doméně (neslužbí omylem user-scoped routes).
const FILE_LISTS = {
  // events-public: čistě veřejné GET routes (čtení published akcí). Žádný wrapper —
  // běží v anon kontextu, RLS public-published policy vrátí správné řádky.
  // Transformace = jen výměna lokálního `new Pool()` za sdílené `db()` z rls-pool.
  'events-public': {
    cfg: [{ noWrap: true }],
    files: [
      'events/[id]/addons', 'events/[id]/bundles', 'events/[id]/calendar',
      'events/[id]/entry-slots', 'events/[id]/lotteries', 'events/[id]/modular-pass',
      'events/[id]/payment-plans', 'events/[id]/recommendations', 'events/[id]/reviews',
      'events/[id]/seat-view-photos', 'events/[id]/seats', 'events/[id]/seats/stream',
      'events/[id]/ticket-types', 'events/[id]/top-picks',
      'events/featured', 'events/nearby',
    ],
  },
  // public-anon: veřejné GET endpointy pod /api/public (anon kontext, public policy)
  'public-anon': {
    cfg: [{ noWrap: true }],
    files: [
      'public/collections/[slug]', 'public/events/[id]/custom-fields',
      'public/events/[id]/pixels', 'public/events/[id]/price-preview',
      'public/incidents', 'public/insurance-plans',
    ],
  },
  // subscriptions veřejné GET (plans/packages katalog) → anon
  'subscriptions-anon': {
    cfg: [{ noWrap: true }],
    files: ['subscriptions/packages/[slug]', 'subscriptions/plans'],
  },
  // guest-supported writes (resale list/cancel/transfer + subscription checkout/confirm) → service
  'buyer-sub-service': {
    cfg: WRAP.internal,
    files: [
      'buyer/resale/list/[id]/cancel', 'buyer/resale/list',
      'buyer/tickets/[ticketId]/transfer',
      'subscriptions/checkout', 'subscriptions/subscribe',
      'subscriptions/holders/[paymentId]/confirm',
    ],
  },
  // auth user-scoped (login-history/sessions/send-verification — povinný x-user-id) → runAsUser
  'auth-user': {
    cfg: WRAP.buyer,
    files: ['auth/login-history', 'auth/sessions', 'auth/send-verification-email'],
  },
  // auth bootstrap (forgot/reset/verify/unsubscribe — pre-auth, token/email) → service
  'auth-service': {
    cfg: WRAP.internal,
    files: ['auth/forgot-password', 'auth/reset-password', 'auth/verify-email', 'auth/unsubscribe'],
  },
  // v1 veřejné kalendářové/RSS feedy (published akce) → anon
  'v1-feed-anon': {
    cfg: [{ noWrap: true }],
    files: ['v1/feed/events.ics', 'v1/feed/events.rss', 'v1/feed/events'],
  },
  // token-auth secure-entry barcode (token = auth) → service
  'v3-service': {
    cfg: WRAP.internal,
    files: ['v3/secure-entry/barcode', 'v3/webhooks'],
  },
  'buyer-service': {
    cfg: WRAP.internal,
    files: [
      'buyer/vouchers/lookup', 'buyer/otp/request', 'buyer/otp/verify',
      'buyer/passkeys/authenticate', 'buyer/tickets/[ticketId]/wallet-content',
      'buyer/spotify/callback', 'buyer/modular-pass/checkout',
      // guest-or-user purchase/transfer operace (jako checkout — route enforce buyer identitu)
      'buyer/resale/buy', 'buyer/tickets/[ticketId]/upgrade', 'buyer/cross-passes/purchase',
    ],
  },
};
const variants = FILE_LISTS[DOMAIN] ? FILE_LISTS[DOMAIN].cfg : WRAP[DOMAIN];
if (!variants) { console.error(`Nepodporovaná doména: ${DOMAIN}`); process.exit(1); }

const API_ROOT = join(process.cwd(), 'nextjs-boilerplate', 'src', 'app', 'api');
const ROOT = FILE_LISTS[DOMAIN] ? API_ROOT : join(API_ROOT, DOMAIN);
const FILE_FILTER = FILE_LISTS[DOMAIN]
  ? FILE_LISTS[DOMAIN].files.map((f) => join(API_ROOT, ...f.split('/'), 'route.ts'))
  : null;

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
  if (FILE_FILTER && !FILE_FILTER.includes(file)) continue;
  let src = readFileSync(file, 'utf8');
  const orig = src;
  const rel = file.split('api' + (process.platform === 'win32' ? '\\' : '/'))[1];

  const hasPoolFn = /let pool: Pool \| null = null;[\s\S]*?return pool;[\s\S]*?\}/.test(src);
  const hasConstPool = /const pool = new Pool\(\{ connectionString: process\.env\.DATABASE_URL \}\);/.test(src);
  if (!hasPoolFn && !hasConstPool) { skips.push(`${rel} — nezná pool pattern`); skipped++; continue; }

  const handlerRe = /export async function (GET|POST|PUT|PATCH|DELETE)\s*\(\s*(\w+)\s*:[^)]*\)\s*:\s*Promise<[^>]+>\s*\{/g;
  const handlers = [...src.matchAll(handlerRe)];
  if (handlers.length === 0) { skips.push(`${rel} — žádný handler`); skipped++; continue; }

  // PER-HANDLER výběr varianty (soubor může mít GET-simple + POST-active apod.)
  const bodyOf = (h) => src.slice(h.index + h[0].length, matchBrace(src, h.index + h[0].length - 1));
  const handlerCfgs = handlers.map((h) => variants.find((v) => (v.preamble ? v.preamble(h[2]).test(bodyOf(h)) : true)));
  if (handlerCfgs.some((c) => !c)) { skips.push(`${rel} — handler bez známé preamble`); skipped++; continue; }

  // transformace od konce (ať indexy sedí)
  for (let i = handlers.length - 1; i >= 0; i--) {
    const h = handlers[i];
    const cfg = handlerCfgs[i];
    if (cfg.noWrap) continue; // jen pool swap, žádné obalení handleru (anon kontext)
    const reqName = h[2];
    const bodyStart = h.index + h[0].length - 1;
    const bodyEnd = matchBrace(src, bodyStart);
    let body = src.slice(bodyStart + 1, bodyEnd);
    let head;
    if (!cfg.preamble) {
      head = `${cfg.fn}(async () => {`;
    } else {
      const uvar = body.match(cfg.preamble(reqName))[1];
      body = body.replace(cfg.preamble(reqName), '');
      const param = new RegExp(`\\b${uvar}\\b`).test(body) ? uvar : `_${uvar}`;
      head = `${cfg.fn}(${reqName}, async (${param}) => {`;
    }
    src = src.slice(0, bodyStart + 1) + `\n  return ${head}\n${body}\n  });\n` + src.slice(bodyEnd);
  }

  // importy + pool swap (CRLF-tolerantní)
  const usedCfgs = [...new Set(handlerCfgs)];
  for (const c of usedCfgs) if (c.removeImport) src = src.replace(c.removeImport, '');
  src = src.replace(/import \{ Pool \} from 'pg';\r?\n/, '');
  src = src.replace(/let pool: Pool \| null = null;[\s\S]*?return pool;[\s\S]*?\}\r?\n/, '');
  src = src.replace(/const pool = new Pool\(\{ connectionString: process\.env\.DATABASE_URL \}\);\r?\n/, '');
  src = src.replace(/\bpool\.query\b/g, 'db().query');
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  // sluč importy podle modulu (dedup názvů)
  const byModule = new Map();
  const addImp = (name, mod) => { if (!byModule.has(mod)) byModule.set(mod, new Set()); byModule.get(mod).add(name); };
  if (!usedCfgs.some((c) => c.ownDb)) addImp('db', '@/lib/db/rls-pool');
  for (const c of usedCfgs) { if (!c.imp) continue; const m = c.imp.match(/import \{ (.+) \} from '(.+)';/); if (m) m[1].split(',').forEach((n) => addImp(n.trim(), m[2])); }
  let importLine = '';
  for (const [mod, names] of byModule) importLine += `import { ${[...names].join(', ')} } from '${mod}';${nl}`;
  if (/\bPool\b/.test(src)) importLine += `import type { Pool } from 'pg';${nl}`;
  src = src.replace(/^(import [^\n]*\n)/m, `$1${importLine}`);

  if (src !== orig) {
    transformed++;
    if (APPLY) writeFileSync(file, src);
    else console.log(`WOULD TRANSFORM: ${rel} (${handlers.length} handler/ů)`);
  }
}

console.log(`\n=== ${APPLY ? 'APLIKOVÁNO' : 'DRY-RUN'} doména=${DOMAIN}: transformováno=${transformed}, skip=${skipped} ===`);
if (skips.length) { console.log('SKIPS (manuál):'); skips.forEach((s) => console.log('  - ' + s)); }
