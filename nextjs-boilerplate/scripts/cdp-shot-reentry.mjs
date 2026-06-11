/**
 * Ověření re-entry settings UI: API round-trip (PATCH→GET, který settings stránka
 * používá) + CDP screenshot karty „Re-entry — opakovaný vstup".
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const ts = Date.now(), PW = 'Demo2026!';
async function api(m, path, body, tok) { const h = {}; if (tok) h.Authorization = 'Bearer ' + tok; if (body !== undefined) h['Content-Type'] = 'application/json'; const r = await fetch('http://localhost:3000' + path, { method: m, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class CDP { constructor(ws){this.ws=ws;this.id=0;this.waiters=new Map();this.events=[];ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id&&this.waiters.has(m.id)){this.waiters.get(m.id)(m);this.waiters.delete(m.id);}else if(m.method)this.events.push(m);};}
  send(method,params={}){const id=++this.id;this.ws.send(JSON.stringify({id,method,params}));return new Promise((res)=>this.waiters.set(id,res));}
  async waitEvent(method,t=8000){const s=Date.now();while(Date.now()-s<t){const i=this.events.findIndex((e)=>e.method===method);if(i>=0)return this.events.splice(i,1)[0];await sleep(50);}return null;} }
async function connect(wsUrl){const ws=new WebSocket(wsUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});return new CDP(ws);}

async function main() {
  const ma = (await api('POST', '/api/auth/login', { email: 'superadmin@tixly.cz', password: PW })).j;
  const ownerEmail = `cdpre${ts}@t.cz`;
  const reg = await api('POST', '/api/auth/register-promoter', { email: ownerEmail, password: PW, name: 'O', companyName: `RE${ts}`, slug: `re${ts}` });
  await api('POST', `/api/platform/promoters/${reg.j.promoterId}/approve`, undefined, ma.accessToken);
  const owner = (await api('POST', '/api/auth/login', { email: ownerEmail, password: PW })).j;
  const ev = await api('POST', '/api/admin/events', { title: `Reentry ${ts}`, description: 'x', category: 'concert', eventType: 'physical', currency: 'CZK', dateStart: '2026-12-22T19:00:00Z', ticketTypes: [{ name: 'Vstup', priceHalire: 30000, capacity: 100, isSeated: false }] }, owner.accessToken);
  const eid = ev.j.eventId || ev.j.id;

  // ── API round-trip (settings stránka volá přesně tohle) ──
  const before = (await api('GET', `/api/admin/events/${eid}`, undefined, owner.accessToken)).j;
  const patch = await api('PATCH', `/api/admin/events/${eid}`, { reentryAllowed: true, reentryMaxCount: 5 }, owner.accessToken);
  const after = (await api('GET', `/api/admin/events/${eid}`, undefined, owner.accessToken)).j;
  console.log('ROUND-TRIP:');
  console.log('  before:', { reentryAllowed: before.reentryAllowed, reentryMaxCount: before.reentryMaxCount });
  console.log('  PATCH status:', patch.status);
  console.log('  after :', { reentryAllowed: after.reentryAllowed, reentryMaxCount: after.reentryMaxCount });
  const ok = after.reentryAllowed === true && after.reentryMaxCount === 5;
  console.log(ok ? '  ✅ round-trip OK (uloženo a načteno zpět)' : '  ❌ round-trip FAIL');

  // ── CDP screenshot karty ──
  const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--remote-debugging-port=9335', '--window-size=1300,1700', '--user-data-dir=' + process.env.TEMP + '/cdp-re-' + ts, 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 30; i++) { await sleep(700); try { ver = await (await fetch('http://127.0.0.1:9335/json/version')).json(); if (ver?.webSocketDebuggerUrl) break; } catch {} }
  let pageTgt = null;
  for (let i = 0; i < 10; i++) { const list = await (await fetch('http://127.0.0.1:9335/json')).json(); pageTgt = list.find((t) => t.type === 'page'); if (pageTgt?.webSocketDebuggerUrl) break; await sleep(400); }
  const cdp = await connect(pageTgt.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: 'http://localhost:3000/cs/login' }); await cdp.waitEvent('Page.loadEventFired'); await sleep(400);
  await cdp.send('Runtime.evaluate', { expression: `(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(ownerEmail)},password:${JSON.stringify(PW)}})});const j=await r.json();localStorage.setItem('accessToken',j.accessToken||'');return !!j.accessToken;})()`, awaitPromise: true });
  await cdp.send('Page.navigate', { url: `http://localhost:3000/admin/events/${eid}/settings` }); await cdp.waitEvent('Page.loadEventFired'); await sleep(3000);
  const probe = await cdp.send('Runtime.evaluate', { expression: `(async()=>{const cards=[...document.querySelectorAll('*')].filter(el=>el.textContent==='Re-entry — opakovaný vstup');const card=cards[cards.length-1]?.closest('div');if(card)card.scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,800));return document.body.innerText.includes('Max počet vstupů na lístek')?'reentry-card-shown':'no-card';})()`, awaitPromise: true });
  await sleep(800);
  const { result } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('C:/Users/omnia/Documents/tixly/state/ui-reentry-settings.png', Buffer.from(result.data, 'base64'));
  console.log('  📸 state/ui-reentry-settings.png', `(${probe?.result?.value})`);
  proc.kill();
  console.log(ok ? '\n✅ HOTOVO' : '\n❌ round-trip selhal');
  if (!ok) process.exit(1);
}
main().catch((e) => { console.error('💥', e.message); process.exit(1); });
