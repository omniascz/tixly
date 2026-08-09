/**
 * E2E — UVNITŘ DASHBOARDŮ. Sweep GET endpointů, které napájejí admin (/admin)
 * a platform (/platform) UI. Pro obě persony s REÁLNÝMI daty (Divadlo Verze má
 * akce + zaplacenou objednávku). Ověřuje, že dashboardy načtou data bez pádu —
 * přesně to, na co uživatel narazí při proklikávání. 5xx = bug.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
const BASE = 'http://localhost:3000', ts = Date.now(), PW = 'Demo2026!';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString: (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1], max: 3 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function q(s, p = []) { const c = await pool.connect(); try { await c.query('BEGIN'); await c.query(`SET LOCAL app.role = 'service'`); const _r = await c.query(s, p); await c.query('COMMIT'); return _r; } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); } }
async function api(method, path, { token, body } = {}) {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`; if (body !== undefined) h['Content-Type'] = 'application/json';
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
  try { const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; }
  catch { return { status: ctl.signal.aborted ? 408 : -1 }; } finally { clearTimeout(timer); }
}
async function login(e) { return (await api('POST', '/api/auth/login', { body: { email: e, password: PW } })).j; }
function walk(dir, acc = []) { for (const n of readdirSync(dir)) { const f = join(dir, n); if (statSync(f).isDirectory()) walk(f, acc); else if (n === 'route.ts') acc.push(f); } return acc; }
const results = [];
function check(l, c, d = '') { const ok = !!c; results.push({ l, ok }); console.log(`  ${ok ? '✅' : '❌'} ${l}${d ? `  → ${d}` : ''}`); return ok; }
function must(l, c, d = '') { if (!check(l, c, d)) throw new Error(`SETUP: ${l} ${d}`); }

async function main() {
  console.log(`\n═══ E2E DASHBOARDY — proklik dat uvnitř /admin + /platform (ts=${ts}) ═══`);
  const ma = await login('superadmin@tixly.cz');
  must('Master admin login', ma?.roles?.isPlatformAdmin);
  const pr = await login('verze@divadlovceletne.cz');
  must('Promotér login (Divadlo Verze)', (pr?.roles?.promoterMemberships?.length ?? 0) > 0);
  const VERZE = '00000000-0000-4000-a000-000000000115';
  const eid = (await q(`SELECT id FROM catalog.events WHERE promoter_id=$1 AND status='published' ORDER BY date_start LIMIT 1`, [VERZE])).rows[0]?.id;
  const ttId = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1 LIMIT 1`, [eid])).rows[0]?.id;
  must('Verze má published akci + ticket type', !!eid && !!ttId);
  // zaplacená objednávka → prodejní data v dashboardu
  const co = await api('POST', '/api/checkout', { body: { eventId: eid, ticketTypeId: ttId, quantity: 2, buyerEmail: `dashbuyer-${ts}@t.cz`, buyerName: 'Dashboard Buyer' } });
  let orderId = co.j?.orderId;
  if (co.j?.paymentId) await api('POST', `/api/mock-gopay/${co.j.paymentId}`, { body: { action: 'pay' } });
  must('Zaplacená objednávka pod Verze (prodejní data)', !!orderId, `checkout=${co.status}`);

  // společné query parametry (dashboardy je často čekají) — extra jsou ignorované
  const QS = `?eventId=${eid}&ticketTypeId=${ttId}&from=2026-01-01&to=2026-12-31&page=1&limit=10&days=30&period=month&range=30d`;
  const DUMMY = '00000000-0000-4000-a000-000000000001';
  function subAdmin(seg) { return { '[id]': eid, '[eventId]': eid, '[ticketTypeId]': ttId, '[orderId]': orderId, '[ticketId]': DUMMY }[seg] ?? DUMMY; }
  function subPlatform(seg, url) { if (url.includes('/promoters/[id]')) return VERZE; return { '[id]': eid, '[eventId]': eid, '[promoterId]': VERZE, '[orderId]': orderId }[seg] ?? DUMMY; }

  function collectGet(rootRel) {
    const ROOT = new URL(`../src/app/api/${rootRel}`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
    const out = [];
    for (const f of walk(ROOT)) {
      const src = readFileSync(f, 'utf8');
      if (!/export\s+(async\s+)?function\s+GET/.test(src)) continue;
      let u = f.slice(f.indexOf('app\\api') >= 0 ? f.indexOf('app\\api') + 7 : f.indexOf('app/api') + 7).replace(/\\/g, '/').replace(/\/route\.ts$/, '');
      u = '/api' + u;
      if (/\/(wallet\/apple|embed|export|webhooks\/|\.well-known)/.test(u)) continue; // ne-dashboard
      out.push(u);
    }
    return out;
  }

  async function sweep(label, rootRel, token, subFn) {
    console.log(`\n━━━ ${label} ━━━`);
    const urls = collectGet(rootRel);
    let ok2 = 0, c4 = 0, bugs = [];
    for (const u of urls) {
      const call = u.replace(/\[[a-zA-Z]+\]/g, (m) => subFn(m, u)) + QS;
      const st = (await api('GET', call, { token })).status;
      await sleep(25); // šetři DB spojení — dev server stíhá uvolňovat pool
      if (st >= 500 || st === 408 || st === -1) bugs.push({ u, st });
      else if (st >= 200 && st < 300) ok2++;
      else c4++;
    }
    if (bugs.length) bugs.forEach(b => console.log(`  ❌ ${b.st}  GET ${b.u}`));
    check(`${label}: ${urls.length} GET endpointů, žádná 5xx/timeout`, bugs.length === 0, `${ok2} ok / ${c4} 4xx / ${bugs.length} bugů`);
    return { total: urls.length, ok2, c4, bugs: bugs.length };
  }

  const plat = await sweep('MASTER ADMIN dashboard (/platform GET)', 'platform', ma.accessToken, subPlatform);
  const adm = await sweep('PROMOTÉR dashboard (/admin GET)', 'admin', pr.accessToken, subAdmin);

  // ── Klíčové dashboard widgety — reálná data, ne jen "nepadá" ─────────────────
  console.log('\n━━━ Klíčové dashboard widgety (obsahová kontrola) ━━━');
  const proms = await api('GET', '/api/platform/promoters', { token: ma.accessToken });
  check('Master admin: promoters list vrací data (200)', proms.status === 200 && JSON.stringify(proms.j ?? '').includes('Verze'), `status=${proms.status}`);
  const evList = await api('GET', '/api/admin/events?limit=50', { token: pr.accessToken });
  const titles = JSON.stringify(evList.j ?? '');
  check('Promotér events list obsahuje Verze akce', evList.status === 200 && titles.includes('Cyrano'), `status=${evList.status}`);
  const sold = (await q(`SELECT count(*) n FROM tickets.tickets t JOIN catalog.ticket_types tt ON tt.id=t.ticket_type_id JOIN catalog.events e ON e.id=tt.event_id WHERE e.promoter_id=$1`, [VERZE])).rows[0]?.n;
  check('Prodané vstupenky pod Verze v DB (z dashboard objednávky)', Number(sold) >= 2, `tickets=${sold}`);

  console.log('\n═══ SOUHRN ═══');
  const passed = results.filter(r => r.ok).length, failed = results.filter(r => !r.ok);
  console.log(`Master admin: ${plat.ok2}/${plat.total} GET ok (${plat.c4} 4xx, ${plat.bugs} bugů)`);
  console.log(`Promotér:     ${adm.ok2}/${adm.total} GET ok (${adm.c4} 4xx, ${adm.bugs} bugů)`);
  console.log(`${passed}/${results.length} kontrol PROŠLO`);
  if (failed.length) { console.log(`\n❌ SELHALO (${failed.length}):`); failed.forEach(f => console.log(`   • ${f.l}`)); }
  else console.log('\n🎉 VŠE PROŠLO — dashboardy načtou data bez pádu pro obě persony.');
}
main().then(() => pool.end()).catch(async e => { console.error('\n💥', e.message); await pool.end(); process.exit(1); });
