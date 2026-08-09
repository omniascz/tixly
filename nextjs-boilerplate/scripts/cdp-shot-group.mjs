/**
 * Vizuální ověření group UI přes Chrome DevTools Protocol (node global WebSocket).
 * Přihlásí (cookie+token), naviguje, proklikne, vyfotí. Reálné screenshoty
 * přihlášeného client-rendered UI (které headless --screenshot neumí).
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
const ts = Date.now(), PW = 'Demo2026!';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString: (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1], max: 3 });
async function q(s, p = []) { const c = await pool.connect(); try { await c.query('BEGIN'); await c.query(`SET LOCAL app.role = 'system'`); const _r = await c.query(s, p); await c.query('COMMIT'); return _r; } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); } }
async function api(m, path, body, tok) { const h = {}; if (tok) h.Authorization = 'Bearer ' + tok; if (body !== undefined) h['Content-Type'] = 'application/json'; const r = await fetch('http://localhost:3000' + path, { method: m, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── minimal CDP client ──────────────────────────────────────────────────────
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiters = new Map(); this.events = []; ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && this.waiters.has(m.id)) { this.waiters.get(m.id)(m); this.waiters.delete(m.id); } else if (m.method) this.events.push(m); }; }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res) => this.waiters.set(id, res)); }
  async waitEvent(method, timeout = 8000) { const start = Date.now(); while (Date.now() - start < timeout) { const i = this.events.findIndex((e) => e.method === method); if (i >= 0) return this.events.splice(i, 1)[0]; await sleep(50); } return null; }
}
async function connect(wsUrl) { const ws = new WebSocket(wsUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); return new CDP(ws); }

async function shoot(cdp, { loginEmail, navigateTo, interact, outFile, settle = 2500 }) {
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  // 1) origin
  await cdp.send('Page.navigate', { url: 'http://localhost:3000/cs/login' });
  await cdp.waitEvent('Page.loadEventFired');
  await sleep(400);
  // 2) login uvnitř browseru (nastaví cookie + localStorage token)
  await cdp.send('Runtime.evaluate', { expression: `(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(loginEmail)},password:${JSON.stringify(PW)}})});const j=await r.json();localStorage.setItem('accessToken',j.accessToken||'');return !!j.accessToken;})()`, awaitPromise: true });
  // 3) cílová stránka
  await cdp.send('Page.navigate', { url: navigateTo });
  await cdp.waitEvent('Page.loadEventFired');
  await sleep(settle);
  if (interact) { await cdp.send('Runtime.evaluate', { expression: interact, awaitPromise: true }); await sleep(2000); }
  const { result } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(outFile, Buffer.from(result.data, 'base64'));
  console.log('  📸', outFile);
}

async function main() {
  // ── data: promotér + akce + buyer + 6-lístková zaplacená objednávka ──
  const ma = (await api('POST', '/api/auth/login', { email: 'superadmin@tixly.cz', password: PW })).j;
  const reg = await api('POST', '/api/auth/register-promoter', { email: `cdp${ts}@t.cz`, password: PW, name: 'C', companyName: `CDP${ts}`, slug: `cdp${ts}` });
  await api('POST', `/api/platform/promoters/${reg.j.promoterId}/approve`, undefined, ma.accessToken);
  const pr = (await api('POST', '/api/auth/login', { email: `cdp${ts}@t.cz`, password: PW })).j;
  const ev = await api('POST', '/api/admin/events', { title: `Skupina ${ts}`, description: 'x', category: 'concert', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-22T19:00:00Z', ticketTypes: [{ name: 'Vstup', priceHalire: 30000, capacity: 100, isSeated: false }] }, pr.accessToken);
  const eid = ev.j.eventId || ev.j.id; await api('POST', `/api/platform/moderation/${eid}/approve`, undefined, ma.accessToken);
  const tt = (await q('SELECT id FROM catalog.ticket_types WHERE event_id=$1', [eid])).rows[0].id;
  const bEmail = `cdpb${ts}@t.cz`;
  await api('POST', '/api/auth/register', { email: bEmail, password: PW, name: 'Skupina Nováků' });
  const co = await api('POST', '/api/checkout', { eventId: eid, ticketTypeId: tt, quantity: 6, buyerEmail: bEmail, buyerName: 'Skupina Nováků' });
  await api('POST', `/api/mock-gopay/${co.j.paymentId}`, { action: 'pay' });
  for (let i = 0; i < 12; i++) { const n = Number((await q(`SELECT count(*) FILTER (WHERE status='valid') v FROM tickets.tickets WHERE order_id=$1`, [co.j.orderId])).rows[0].v); if (n === 6) break; await sleep(500); }
  const buyer = (await api('POST', '/api/auth/login', { email: bEmail, password: PW })).j;
  const gq = await api('GET', `/api/buyer/orders/${co.j.orderId}/group-qr`, undefined, buyer.accessToken);
  console.log('Setup: order', co.j.orderId, '| group token len', gq.j?.token?.length);

  // ── launch Chrome s remote debugging ──
  const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=9333`, '--window-size=1280,1400', '--user-data-dir=' + process.env.TEMP + '/cdp-' + ts, 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 30; i++) { await sleep(700); try { ver = await (await fetch('http://127.0.0.1:9333/json/version')).json(); if (ver?.webSocketDebuggerUrl) break; } catch { /* not ready */ } }
  if (!ver?.webSocketDebuggerUrl) throw new Error('Chrome debug endpoint nenastartoval (9333)');
  // existující page target (Chrome startuje s about:blank)
  let pageTgt = null;
  for (let i = 0; i < 10; i++) { const list = await (await fetch('http://127.0.0.1:9333/json')).json(); pageTgt = list.find((t) => t.type === 'page'); if (pageTgt?.webSocketDebuggerUrl) break; await sleep(400); }
  if (!pageTgt?.webSocketDebuggerUrl) throw new Error('Žádný page target');
  const cdp = await connect(pageTgt.webSocketDebuggerUrl);

  console.log('\n📷 Buyer group QR:');
  await shoot(cdp, { loginEmail: bEmail, navigateTo: `http://localhost:3000/cs/orders/${co.j.orderId}/group-qr`, outFile: 'C:/Users/omnia/Documents/tixly/state/ui-group-buyer.png' });

  console.log('📷 Scanner group panel (preview se seznamem):');
  // přepni na group mode, vlož token, klikni Načíst
  const interact = `(async()=>{
    const mg=document.querySelector('[data-testid=mode-group]'); if(mg) mg.click(); await new Promise(r=>setTimeout(r,600));
    const inp=document.querySelector('[data-testid=group-token-input]'); if(inp){const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;set.call(inp,${JSON.stringify(gq.j.token)});inp.dispatchEvent(new Event('input',{bubbles:true}));}
    await new Promise(r=>setTimeout(r,900));
    const btns=[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('Načíst')); if(btns[0]) btns[0].click();
    await new Promise(r=>setTimeout(r,2500));
    return document.querySelector('[data-testid=group-ticket-list]')?'LIST_SHOWN':'no-list';
  })()`;
  await shoot(cdp, { loginEmail: `cdp${ts}@t.cz`, navigateTo: 'http://localhost:3000/admin/scanner', interact, outFile: 'C:/Users/omnia/Documents/tixly/state/ui-group-scanner.png', settle: 3000 });

  proc.kill();
  console.log('\n✅ hotovo');
}
main().then(() => pool.end()).catch(async (e) => { console.error('💥', e.message); await pool.end(); process.exit(1); });
