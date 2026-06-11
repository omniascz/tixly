/**
 * CDP screenshot — venue seating chart v superadminu (authed, client-rendered).
 * Login superadmin → /platform/venues/<id>/seating-chart → captureScreenshot.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PW = 'Demo2026!';
const VENUE = 'a4198135-b842-4f53-b1e3-a95462944a4a';
const ts = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiters = new Map(); this.events = []; ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && this.waiters.has(m.id)) { this.waiters.get(m.id)(m); this.waiters.delete(m.id); } else if (m.method) this.events.push(m); }; }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res) => this.waiters.set(id, res)); }
  async waitEvent(method, timeout = 10000) { const s = Date.now(); while (Date.now() - s < timeout) { const i = this.events.findIndex((e) => e.method === method); if (i >= 0) return this.events.splice(i, 1)[0]; await sleep(50); } return null; }
}
async function connect(wsUrl) { const ws = new WebSocket(wsUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); return new CDP(ws); }

async function main() {
  const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9334', '--window-size=1280,1500', '--user-data-dir=' + process.env.TEMP + '/cdp-venue-' + ts, 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 30; i++) { await sleep(700); try { ver = await (await fetch('http://127.0.0.1:9334/json/version')).json(); if (ver?.webSocketDebuggerUrl) break; } catch {} }
  if (!ver?.webSocketDebuggerUrl) throw new Error('Chrome debug nenastartoval');
  let pageTgt = null;
  for (let i = 0; i < 10; i++) { const list = await (await fetch('http://127.0.0.1:9334/json')).json(); pageTgt = list.find((t) => t.type === 'page'); if (pageTgt?.webSocketDebuggerUrl) break; await sleep(400); }
  const cdp = await connect(pageTgt.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');

  await cdp.send('Page.navigate', { url: 'http://localhost:3000/cs/login' });
  await cdp.waitEvent('Page.loadEventFired'); await sleep(400);
  const login = await cdp.send('Runtime.evaluate', { expression: `(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'superadmin@tixly.cz',password:'${PW}'})});const j=await r.json();localStorage.setItem('accessToken',j.accessToken||'');return j.accessToken?('OK roles='+JSON.stringify(j.roles?.isPlatformAdmin)):'NO_TOKEN';})()`, awaitPromise: true });
  console.log('login:', login.result?.value);

  await cdp.send('Page.navigate', { url: `http://localhost:3000/platform/venues/${VENUE}/seating-chart` });
  await cdp.waitEvent('Page.loadEventFired'); await sleep(6000);
  // počkej (uvnitř stránky) na SVG s mnoha <circle> (mapa), pak vrať jeho bbox
  const box = await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    expression: `(async()=>{for(let i=0;i<40;i++){const svgs=[...document.querySelectorAll('svg')];const map=svgs.find(s=>s.querySelectorAll('circle').length>50);if(map){const r=map.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height,circles:map.querySelectorAll('circle').length});}await new Promise(r=>setTimeout(r,300));}return null;})()`,
  });
  const bb = box.result?.value ? JSON.parse(box.result.value) : null;
  console.log('svg box:', bb);
  const clip = bb && bb.w > 0 ? { x: Math.max(0, bb.x - 10), y: Math.max(0, bb.y - 10), width: bb.w + 20, height: bb.h + 20, scale: 2 } : undefined;
  const { result } = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
  const out = `C:/Users/omnia/Documents/tixly/state/ui-dvd-chart-zoom.png`;
  writeFileSync(out, Buffer.from(result.data, 'base64'));
  console.log(`📸 → ${out}`);
  proc.kill();
}
main().catch((e) => { console.error('💥', e.message); process.exit(1); });
