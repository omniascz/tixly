// Kolo 4 / krok 2 — inventura VŠECH API rout: routa | metoda | typ volajícího | ochrana.
// Staticky: zóna middlewaru podle cesty (čte seznamy přímo ze src/middleware.ts) + guard v handleru.
// Výstup: logs/r4/2_routes.tsv (tabulka) a logs/r4/2_routes.json (vstup generovaného testu).
// Pouziti: node audit/r4/classify-routes.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '../..');
const APP = path.join(ROOT, 'nextjs-boilerplate/src/app');
const MW = readFileSync(path.join(ROOT, 'nextjs-boilerplate/src/middleware.ts'), 'utf8');

const list = (name) => {
  const m = new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(MW);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
};
const L = {
  publicPrefix: list('PUBLIC_API_PREFIXES'),
  publicGet: list('API_PUBLIC_GET_ROUTES'),
  promoter: list('API_PROMOTER_PREFIXES'),
  platform: list('API_PLATFORM_PREFIXES'),
  optional: list('API_OPTIONAL_AUTH_PREFIXES'),
};

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n === 'route.ts') out.push(p);
  }
  return out;
}

function zone(route, method) {
  if (route.startsWith('/api/auth/')) return 'auth';
  if (L.publicPrefix.some((r) => route.startsWith(r))) return 'public-prefix';
  if (method === 'GET' && L.publicGet.some((r) => route.startsWith(r))) return 'public-get';
  if (L.platform.some((r) => route.startsWith(r))) return 'mw-platform';
  if (L.promoter.some((r) => route.startsWith(r))) return 'mw-promoter';
  if (L.optional.some((r) => route.startsWith(r))) return 'optional';
  return 'unlisted';
}

// Guardy v handleru (pořadí = priorita při určení typu volajícího).
const GUARDS = [
  ['admin', /requirePlatformAdmin|runWithPlatformAdminContext\(|verifyAdminToken|isPlatformAdmin\s*\)|requireAdmin\b/],
  ['promoter', /runAsPromoter|runAsActivePromoter|requirePromoter|requirePromoterAccess|requireEventAccess|requireOrganizer|getPromoterContext/],
  ['reseller', /requireReseller|verifyResellerToken/],
  ['service', /isCronAuthorized|verifyInternalToken|isInternalTokenAuthorized|CRON_SECRET|INTERNAL_SERVICE_TOKEN|INTERNAL_API_TOKEN|verifyCron/],
  ['webhook', /verify[A-Za-z]*Signature|createHmac|timingSafeEqual|webhook.?secret|WEBHOOK_SECRET|verifyNotification|signature/i],
  ['partner', /requireApiKey|verifyApiKey|requireOAuth|verifyPartner|requirePartner|api[_-]?key|x-api-key|requireTenant|verifyTenant|requireB2B|requireDistribution|verifyDeviceKey|deviceKey/i],
  ['buyer', /runAsUser|x-user-id/],
];

const files = walk(path.join(APP, 'api'));
const rows = [];
for (const f of files) {
  const rel = path.relative(APP, path.dirname(f)).split(path.sep).join('/');
  const route = '/' + rel;
  const src = readFileSync(f, 'utf8');
  const methods = [...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g)].map((m) => m[1] ?? m[2]);
  const guards = GUARDS.filter(([, re]) => re.test(src)).map(([k]) => k);
  const capability = /\[(token|code|slug|hash|key|shareToken|accessToken)\]/.test(route);
  const reads401 = /status:\s*401|UNAUTHORIZED|runAsUser/.test(src);
  for (const method of [...new Set(methods)]) {
    const z = zone(route, method);
    let caller;
    let protection;
    if (z === 'mw-platform') { caller = 'admin'; protection = 'middleware: platform admin'; }
    else if (z === 'mw-promoter') { caller = guards.includes('admin') && !guards.includes('promoter') ? 'admin' : 'pořadatel'; protection = 'middleware: přihlášení + členství'; }
    else if (guards.includes('admin')) { caller = 'admin'; protection = 'handler: platform admin'; }
    else if (guards.includes('promoter')) { caller = 'pořadatel'; protection = 'handler: pořadatel'; }
    else if (guards.includes('reseller')) { caller = 'prodejce'; protection = 'handler: prodejce (Bearer)'; }
    else if (guards.includes('service')) { caller = 'servis'; protection = 'handler: tajemství (cron/interní)'; }
    else if (guards.includes('webhook')) { caller = 'servis'; protection = 'handler: podpis/tajemství'; }
    else if (guards.includes('partner')) { caller = 'partner'; protection = 'handler: API klíč/token partnera'; }
    else if (guards.includes('buyer') && reads401) { caller = 'kupec'; protection = z === 'optional' || z === 'unlisted' || z === 'public-prefix' || z === 'public-get' ? 'handler: x-user-id (401)' : 'handler'; }
    else if (capability) { caller = 'veřejná (capability)'; protection = 'tajný token v URL'; }
    else if (z === 'auth') { caller = 'veřejná (auth)'; protection = 'přihlašovací tok'; }
    else { caller = 'veřejná?'; protection = 'žádná'; }
    rows.push({ route, method, zone: z, caller, protection, guards: guards.join('+') });
  }
}
rows.sort((a, b) => (a.route + a.method).localeCompare(b.route + b.method));
const out = path.join(ROOT, 'logs/r4');
writeFileSync(path.join(out, '2_routes.json'), JSON.stringify(rows, null, 1));
writeFileSync(path.join(out, '2_routes.tsv'),
  'routa\tmetoda\ttyp volajícího\tochrana\tzóna middlewaru\tguardy\n' +
  rows.map((r) => [r.route, r.method, r.caller, r.protection, r.zone, r.guards].join('\t')).join('\n') + '\n');
const count = {};
for (const r of rows) count[r.caller] = (count[r.caller] ?? 0) + 1;
console.log(JSON.stringify({ files: files.length, routeMethods: rows.length, byCaller: count }, null, 1));
