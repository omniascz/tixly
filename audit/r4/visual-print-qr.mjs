/**
 * Kolo 4 / závěr — vizuální kontrola tištěné vstupenky prodejce (krok 3h) a skeneru.
 *
 * Proti běžící aplikaci (:3200, tixly_app) a izolované DB e2e:
 *   1. založí prodejce (heslo bcrypt) + reseller_sales k zaplacené objednávce
 *   2. headless Chrome přes CDP: přihlášení prodejce přes /api/reseller/auth (token do
 *      localStorage jako /reseller/login), stránka /reseller/print/<orderId> → screenshot
 *   3. QR se dekóduje ZE SCREENSHOTU (jsQR) — ověřuje, že na papíře je skutečný QR s TXP2
 *   4. skener /admin/scanner: přihlášený pořadatel vloží dekódovaný obsah → screenshot výsledku
 *
 * Použití: node audit/r4/visual-print-qr.mjs <orderId> <eventId> <promoterEmail> <password> <outDir> <scratchNodeModules>
 * Akce se na dobu běhu posune na +1 h (rotating_24h → bez TXP2 by skener chtěl TOTP), pak se vrátí.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const [orderId, eventId, promoterEmail, password, outDir, nm] = process.argv.slice(2);
const req = createRequire(path.join(nm, 'x.js'));
const pg = req('pg'), bcrypt = req('bcryptjs'), jsQR = req('jsqr'), { PNG } = req('pngjs');
const BASE = 'http://localhost:3200';
const owner = new pg.Pool({ connectionString: 'postgresql://neondb_owner:fixowner@localhost:55632/e2e', max: 2 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.w = new Map(); this.ev = []; ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && this.w.has(m.id)) { this.w.get(m.id)(m); this.w.delete(m.id); } else if (m.method) this.ev.push(m); }; }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((r) => this.w.set(id, r)); }
  async load(url) { this.ev = []; await this.send('Page.navigate', { url }); for (let i = 0; i < 200; i++) { if (this.ev.some((e) => e.method === 'Page.loadEventFired')) return; await sleep(50); } }
  async js(expression) { const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; }
  async shot(file) { const { result } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(file, Buffer.from(result.data, 'base64')); return file; }
}

const out = {};
const oldDate = (await owner.query('SELECT date_start FROM catalog.events WHERE id=$1', [eventId])).rows[0].date_start;
let chrome, pid;
try {
  await owner.query(`UPDATE catalog.events SET date_start = NOW() + INTERVAL '1 hour' WHERE id=$1`, [eventId]);
  const email = `vis-${Date.now()}@reseller.test`, rpw = 'Vis2026!x';
  pid = (await owner.query(`INSERT INTO platform.reseller_partners (name, contact_email, password_hash, commission_pct, status) VALUES ('Prodejna Vizuál',$1,$2,5,'active') RETURNING id`, [email, bcrypt.hashSync(rpw, 10)])).rows[0].id;
  await owner.query(`INSERT INTO orders.reseller_sales (partner_id, order_id, commission_pct, commission_amount_halire) VALUES ($1,$2,5,500)`, [pid, orderId]);

  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9344', '--window-size=1100,1500', `--user-data-dir=${process.env.TEMP}/cdp-r4-${Date.now()}`, 'about:blank'], { stdio: 'ignore' });
  let tgt;
  for (let i = 0; i < 40 && !tgt; i++) { await sleep(500); try { tgt = (await (await fetch('http://127.0.0.1:9344/json')).json()).find((t) => t.type === 'page'); } catch { /* start */ } }
  const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const cdp = new CDP(ws); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');

  // ── 1) tisk u prodejce ──
  await cdp.load(`${BASE}/reseller/login`);
  out.resellerLogin = await cdp.js(`(async()=>{const r=await fetch('/api/reseller/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)},password:${JSON.stringify(rpw)}})});const j=await r.json();if(j.token){localStorage.setItem('resellerToken',j.token);localStorage.setItem('resellerPartnerName',j.partnerName||'P');}return r.status+':'+Object.keys(j).join(',');})()`);
  await cdp.load(`${BASE}/reseller/print/${orderId}`);
  await sleep(4000);
  const printPng = await cdp.shot(path.join(outDir, 'z_visual_reseller_print.png'));
  out.printText = (await cdp.js('document.body.innerText')).slice(0, 400);

  // ── 2) QR ze screenshotu: každý <img alt="QR…"> zvlášť (výřez s bílým okrajem karty, 2× DPR) ──
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1500, deviceScaleFactor: 2, mobile: false });
  await sleep(800);
  const rects = await cdp.js(`[...document.querySelectorAll('img[alt^="QR"]')].map(i=>{const r=i.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,w:r.width,h:r.height}})`);
  const hiPng = await cdp.shot(path.join(outDir, 'z_visual_reseller_print_2x.png'));
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  const png = PNG.sync.read(readFileSync(hiPng));
  const decoded = [];
  for (const r of rects) {
    const m = 12, x0 = Math.max(0, Math.floor((r.x - m) * 2)), y0 = Math.max(0, Math.floor((r.y - m) * 2));
    const w = Math.min(png.width - x0, Math.ceil((r.w + 2 * m) * 2)), h = Math.min(png.height - y0, Math.ceil((r.h + 2 * m) * 2));
    const buf = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) buf.set(png.data.subarray(((y0 + y) * png.width + x0) * 4, ((y0 + y) * png.width + x0 + w) * 4), y * w * 4);
    const q = jsQR(buf, w, h);
    decoded.push(q ? q.data : null);
  }
  out.qrCount = rects.length;
  out.qrDecoded = decoded.map((d) => (d ? `${d.slice(0, 5)}… (${d.length} zn.)` : null));
  const qr = decoded[0] ? { data: decoded[0] } : null;
  if (!qr) throw new Error('QR se ze screenshotu nepodařilo dekódovat');
  out.qrFormat = decoded.every((d) => d && d.startsWith('TXP2.')) ? 'TXP2 (všechny)' : 'NE-TXP2';

  // ── 3) skener ──
  await cdp.load(`${BASE}/cs/login`);
  out.promoterLogin = await cdp.js(`(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(promoterEmail)},password:${JSON.stringify(password)}})});const j=await r.json();localStorage.setItem('accessToken',j.accessToken||'');localStorage.setItem('tixly.scanner.gate',JSON.stringify({eventId:${JSON.stringify(eventId)},eventDayId:null,zoneId:null}));return r.status;})()`);
  await cdp.load(`${BASE}/admin/scanner`);
  await sleep(4000);
  out.scanSubmit = await cdp.js(`(async()=>{const i=document.querySelector('[data-testid=scanner-ticket-input]');if(!i)return 'no-input';const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(qr.data)});i.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,300));i.form.requestSubmit();return 'submitted';})()`);
  await sleep(4000);
  await cdp.shot(path.join(outDir, 'z_visual_scanner_result.png'));
  out.scannerText = (await cdp.js('document.body.innerText')).replace(/\s+/g, ' ').slice(0, 600);
  out.ticketStatuses = (await owner.query(`SELECT status, count(*)::int n FROM tickets.tickets WHERE order_id=$1 GROUP BY 1`, [orderId])).rows;
} finally {
  await owner.query('UPDATE catalog.events SET date_start=$2 WHERE id=$1', [eventId, oldDate]);
  if (pid) { await owner.query('DELETE FROM orders.reseller_sales WHERE partner_id=$1', [pid]); await owner.query('DELETE FROM platform.reseller_partners WHERE id=$1', [pid]); }
  chrome?.kill();
  await owner.end();
  console.log(JSON.stringify(out, null, 1));
}
