// E2E 08: IDOR sweep — VSECHNY GET routy s dynamickym segmentem v URL (z filesystemu src/app/api).
// Parametry se dosadi ID zdroju tenantu A / kupce `buyer`; volaji 3 cizi aktori:
//   promoterB (jiny tenant), other (jiny kupec), anon (neprihlaseny).
// NALEZ = odpoved 2xx, jejiz telo obsahuje SOUKROMY marker obeti (e-mail kupce, ID objednavky/vstupenky,
// promo kod, e-mail poradatele A). Verejna data (nazev publikovane akce) marker NEJSOU.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client, q, owner, startLog, check, summary } from './lib.mjs';

startLog('08_idor_sweep');
const S = JSON.parse(readFileSync(new URL(process.env.AUDIT_STATE ?? './state.json', import.meta.url), 'utf8'));
const API = path.resolve(import.meta.dirname, '../../nextjs-boilerplate/src/app/api');
const login = async (name, email) => { const c = new Client(name); const r = await c.post('/api/auth/login', { email, password: S.pw }); if (r.status !== 200) throw new Error(`login ${email} ${r.status}`); return c; };

const ord = (await q(`SELECT o.id FROM orders.orders o WHERE o.user_id=$1 AND o.status='paid' AND o.event_id=$2 ORDER BY o.created_at LIMIT 1`, [S.buyerId, S.eventA]))[0].id;
const tks = await q(`SELECT id FROM tickets.tickets WHERE order_id=$1`, [ord]);
const inv = (await q(`SELECT id FROM accounting.invoices LIMIT 1`).catch(() => []))[0]?.id;
const promoId = (await q(`SELECT id FROM marketing.promo_codes WHERE upper(code)=$1`, [S.promo]))[0]?.id;
const rreq = (await q(`SELECT id FROM orders.refund_requests LIMIT 1`).catch(() => []))[0]?.id;
const ID = { event: S.eventA, order: ord, ticket: tks[0].id, promoter: S.promoterA.id, user: S.buyerId, venue: S.venueId, tt: S.tt['Stani'], invoice: inv, promo: promoId, refund: rreq };
const MARKERS = [S.buyerEmail, ord, tks[0].id, S.promo, S.promoterA.email, 'Kupec Audit'].filter(Boolean);

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) { const p = path.join(dir, f); if (statSync(p).isDirectory()) walk(p, out); else if (f === 'route.ts') out.push(p); }
  return out;
}
function resolveParam(name, segsBefore) {
  const n = name.toLowerCase(); const parent = (segsBefore.at(-1) ?? '').toLowerCase();
  if (/order/.test(n)) return ID.order; if (/ticket/.test(n) && !/type/.test(n)) return ID.ticket; if (/event/.test(n)) return ID.event;
  if (/promoter/.test(n)) return ID.promoter; if (/user|customer|buyer/.test(n)) return ID.user; if (/venue/.test(n)) return ID.venue; if (n === 'ttid') return ID.tt;
  if (n === 'id') {
    if (/events?$/.test(parent)) return ID.event; if (/orders?$/.test(parent)) return ID.order; if (/tickets?$/.test(parent)) return ID.ticket;
    if (/promoters?$/.test(parent)) return ID.promoter; if (/venues?$/.test(parent)) return ID.venue; if (/customers?|users?$/.test(parent)) return ID.user;
    if (/invoices?$/.test(parent)) return ID.invoice; if (/promo-codes?$/.test(parent)) return ID.promo; if (/refund-requests?$/.test(parent)) return ID.refund; if (/ticket-types?$/.test(parent)) return ID.tt;
  }
  return null;
}
const routes = [];
let skipped = 0;
for (const f of walk(API)) {
  const rel = path.relative(API, path.dirname(f)).split(path.sep);
  if (!rel.some((s) => s.startsWith('['))) continue;
  if (!/export\s+(async\s+)?function\s+GET|export\s+const\s+GET/.test(readFileSync(f, 'utf8'))) continue;
  const segs = []; let ok = true;
  for (const s of rel) { if (s.startsWith('[')) { const v = resolveParam(s.replace(/[[\].]/g, ''), segs); if (!v) { ok = false; break; } segs.push(v); } else segs.push(s); }
  if (!ok) { skipped++; continue; }
  routes.push({ file: rel.join('/'), url: '/api/' + segs.join('/') });
}

const actors = { promoterB: await login('promoterB', S.promoterB.email), otherBuyer: await (async () => { const c = new Client('other2'); const r = await c.post('/api/auth/register', { email: `other2-${Date.now()}@audit.test`, password: S.pw, name: 'Jiny Kupec 2' }); if (r.status !== 200) throw new Error('register other2 ' + r.status); return c; })(), anon: new Client('anon') };
const findings = []; const stat = {};
for (const rt of routes) {
  for (const [an, c] of Object.entries(actors)) {
    let r; try { r = await c.get(rt.url); } catch (e) { r = { status: 0, text: String(e) }; }
    const k = `${an}:${Math.floor(r.status / 100)}xx`; stat[k] = (stat[k] ?? 0) + 1;
    if (r.status >= 500) findings.push({ kind: '5xx', actor: an, route: rt.file, status: r.status });
    if (r.status >= 200 && r.status < 300) { const hit = MARKERS.filter((m) => (r.text ?? '').includes(m)); if (hit.length) findings.push({ kind: 'LEAK', actor: an, route: rt.file, status: r.status, markers: hit, sample: r.text.slice(0, 200) }); }
  }
}
const leaks = findings.filter((f) => f.kind === 'LEAK'); const errs = findings.filter((f) => f.kind === '5xx');
writeFileSync(new URL(`../logs/${process.env.AUDIT_LOG_PREFIX ?? ''}e2e_08_idor_findings.json`, import.meta.url), JSON.stringify({ tested: routes.length, skippedUnresolvedParam: skipped, stat, leaks, errs }, null, 1));
check('I1', `IDOR sweep: ${routes.length} GET rout s ID v URL x 3 cizi aktori — zadna odpoved 2xx s privatnimi daty obeti`, leaks.length === 0, { tested: routes.length, skippedUnresolvedParam: skipped, stat, leaks: leaks.map((l) => `${l.actor} ${l.route} [${l.markers.join(',').slice(0, 60)}]`) });
check('I2', 'IDOR sweep: routy vracejici 5xx cizimu aktorovi (chyba misto 401/403/404)', errs.length === 0, { count: errs.length, routes: [...new Set(errs.map((e) => e.route))].slice(0, 60) });
summary();
await owner.end();
