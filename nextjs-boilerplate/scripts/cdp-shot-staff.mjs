/**
 * Vizuální ověření produkčních/staff UI změn přes Chrome DevTools Protocol.
 * Screenshoty přihlášeného client-rendered UI (headless --screenshot to neumí).
 *
 * Fotí: (1) skener s offline-manifest řádkem, (2) POS karta = externí terminál,
 * (3) personál s kartou čekajících pozvánek, (4) sidebar pod rolí 'staff'.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import pg from 'pg';
const ts = Date.now(), PW = 'Demo2026!';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString: (env.match(/^DATABASE_URL="?([^"\n]+)"?/m) || [])[1], max: 3 });
async function q(s, p = []) { const c = await pool.connect(); try { await c.query('BEGIN'); await c.query(`SET LOCAL app.role = 'system'`); const _r = await c.query(s, p); await c.query('COMMIT'); return _r; } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); } }
async function api(m, path, body, tok) { const h = {}; if (tok) h.Authorization = 'Bearer ' + tok; if (body !== undefined) h['Content-Type'] = 'application/json'; const r = await fetch('http://localhost:3000' + path, { method: m, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiters = new Map(); this.events = []; ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && this.waiters.has(m.id)) { this.waiters.get(m.id)(m); this.waiters.delete(m.id); } else if (m.method) this.events.push(m); }; }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res) => this.waiters.set(id, res)); }
  async waitEvent(method, timeout = 8000) { const start = Date.now(); while (Date.now() - start < timeout) { const i = this.events.findIndex((e) => e.method === method); if (i >= 0) return this.events.splice(i, 1)[0]; await sleep(50); } return null; }
}
async function connect(wsUrl) { const ws = new WebSocket(wsUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); return new CDP(ws); }

async function shoot(cdp, { loginEmail, navigateTo, interact, outFile, settle = 2500 }) {
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: 'http://localhost:3000/cs/login' });
  await cdp.waitEvent('Page.loadEventFired'); await sleep(400);
  const lg = await cdp.send('Runtime.evaluate', { expression: `(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(loginEmail)},password:${JSON.stringify(PW)}})});const j=await r.json();localStorage.setItem('accessToken',j.accessToken||'');return !!j.accessToken;})()`, awaitPromise: true });
  if (lg?.result?.value !== true) console.log('  ⚠ login nevrátil token pro', loginEmail);
  await cdp.send('Page.navigate', { url: navigateTo });
  await cdp.waitEvent('Page.loadEventFired'); await sleep(settle);
  let probe = null;
  if (interact) { const r = await cdp.send('Runtime.evaluate', { expression: interact, awaitPromise: true }); probe = r?.result?.value; await sleep(1500); }
  const { result } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(outFile, Buffer.from(result.data, 'base64'));
  console.log('  📸', outFile, probe ? `(${probe})` : '');
}

async function main() {
  // ── data: owner promotér + budoucí publikovaná akce s lístky + staff user ──
  const ma = (await api('POST', '/api/auth/login', { email: 'superadmin@tixly.cz', password: PW })).j;
  const ownerEmail = `cdpown${ts}@t.cz`;
  const reg = await api('POST', '/api/auth/register-promoter', { email: ownerEmail, password: PW, name: 'Owner', companyName: `CDP${ts}`, slug: `cdp${ts}` });
  const promoterId = reg.j.promoterId;
  await api('POST', `/api/platform/promoters/${promoterId}/approve`, undefined, ma.accessToken);
  const owner = (await api('POST', '/api/auth/login', { email: ownerEmail, password: PW })).j;
  const ev = await api('POST', '/api/admin/events', { title: `Produkce ${ts}`, description: 'x', category: 'concert', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-22T19:00:00Z', ticketTypes: [{ name: 'Vstup', priceHalire: 30000, capacity: 100, isSeated: false }] }, owner.accessToken);
  const eid = ev.j.eventId || ev.j.id;
  await api('POST', `/api/platform/moderation/${eid}/approve`, undefined, ma.accessToken);
  console.log('Setup: promotér', promoterId, '| akce', eid);

  // prodej pár lístků, ať má manifest co stáhnout
  const bEmail = `cdpb${ts}@t.cz`;
  const tt = (await q('SELECT id FROM catalog.ticket_types WHERE event_id=$1', [eid])).rows[0].id;
  await api('POST', '/api/auth/register', { email: bEmail, password: PW, name: 'Kupující' });
  const co = await api('POST', '/api/checkout', { eventId: eid, ticketTypeId: tt, quantity: 3, buyerEmail: bEmail, buyerName: 'Kupující' });
  if (co.j?.paymentId) { await api('POST', `/api/mock-gopay/${co.j.paymentId}`, { action: 'pay' }); await sleep(1500); }

  // čekající pozvánka (pro kartu "Čekající pozvánky")
  const inv = await api('POST', '/api/admin/staff', { email: `pozvany${ts}@t.cz`, role: 'staff' }, owner.accessToken);
  console.log('Pozvánka:', inv.status);

  // staff user → členství role='staff' (musí být PŘED jeho loginem, ať je v JWT)
  const staffEmail = `cdpstaff${ts}@t.cz`;
  await api('POST', '/api/auth/register', { email: staffEmail, password: PW, name: 'Produkční Pavel' });
  const staffUid = (await q('SELECT id FROM identity.users WHERE email=$1', [staffEmail])).rows[0].id;
  await q(`INSERT INTO platform.promoter_members (promoter_id, user_id, role, status) VALUES ($1,$2,'staff','active') ON CONFLICT (promoter_id, user_id) DO UPDATE SET role='staff', status='active'`, [promoterId, staffUid]);
  console.log('Staff user:', staffEmail, staffUid);

  // ── Chrome CDP ──
  const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9334', '--window-size=1300,1500', '--user-data-dir=' + process.env.TEMP + '/cdp-staff-' + ts, 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 30; i++) { await sleep(700); try { ver = await (await fetch('http://127.0.0.1:9334/json/version')).json(); if (ver?.webSocketDebuggerUrl) break; } catch {} }
  if (!ver?.webSocketDebuggerUrl) throw new Error('Chrome debug endpoint (9334) nenastartoval');
  let pageTgt = null;
  for (let i = 0; i < 10; i++) { const list = await (await fetch('http://127.0.0.1:9334/json')).json(); pageTgt = list.find((t) => t.type === 'page'); if (pageTgt?.webSocketDebuggerUrl) break; await sleep(400); }
  const cdp = await connect(pageTgt.webSocketDebuggerUrl);
  const OUT = 'C:/Users/omnia/Documents/tixly/state';

  console.log('\n📷 (1) Skener — offline manifest:');
  const scanInteract = `(async()=>{
    const sel=document.querySelector('select'); if(sel){const set=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;set.call(sel,${JSON.stringify(eid)});sel.dispatchEvent(new Event('change',{bubbles:true}));}
    await new Promise(r=>setTimeout(r,1400));
    const dl=[...document.querySelectorAll('button')].find(b=>/Stáhnout offline seznam|Aktualizovat/.test(b.textContent));
    if(dl) dl.click();
    await new Promise(r=>setTimeout(r,2500));
    return document.body.innerText.includes('Offline seznam')?'manifest-row-shown':'no-manifest-row';
  })()`;
  await shoot(cdp, { loginEmail: ownerEmail, navigateTo: 'http://localhost:3000/admin/scanner', interact: scanInteract, outFile: OUT + '/ui-staff-scanner.png', settle: 3000 });

  console.log('📷 (2) POS — karta externí terminál:');
  const posInteract = `(async()=>{
    const card=document.querySelector('input[value=card_terminal]'); if(card) card.click();
    await new Promise(r=>setTimeout(r,800));
    return document.body.innerText.includes('Tixly kartu')?'warning-shown':'no-warning';
  })()`;
  await shoot(cdp, { loginEmail: ownerEmail, navigateTo: 'http://localhost:3000/admin/pos', interact: posInteract, outFile: OUT + '/ui-staff-pos.png', settle: 3000 });

  console.log('📷 (3) Personál — čekající pozvánky:');
  await shoot(cdp, { loginEmail: ownerEmail, navigateTo: 'http://localhost:3000/admin/staff', outFile: OUT + '/ui-staff-invites.png', settle: 3000 });

  console.log('📷 (4) Sidebar pod rolí staff:');
  const sbProbe = `(async()=>{const t=document.body.innerText; return (t.includes('Produkční přístup')?'BANNER ':'')+(t.includes('Výplaty')?'!FINANCE-VISIBLE':'finance-hidden')+(t.includes('Scanner')?' scanner-ok':'')})()`;
  await shoot(cdp, { loginEmail: staffEmail, navigateTo: 'http://localhost:3000/admin', interact: sbProbe, outFile: OUT + '/ui-staff-sidebar.png', settle: 3500 });

  proc.kill();
  console.log('\n✅ hotovo — 4 screenshoty v state/');
}
main().then(() => pool.end()).catch(async (e) => { console.error('💥', e.message, e.stack); await pool.end(); process.exit(1); });
