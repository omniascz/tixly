/**
 * Kolo 7 — vizuální ověření UI změn přes Chrome DevTools Protocol (přihlášené client-rendered stránky).
 * Proti lokální aplikaci (APP, výchozí http://localhost:3200) a izolované DB (OWNER_URL). Data si založí sám.
 *
 * Fotí: (1) stránka akce po uzávěrce → „Prodej ukončen", (2) /admin/payouts pořadatele (čeká na ruční
 * převod, žádné vymyšlené „Vyplaceno"), (3) /platform/payouts (potvrzení převodu), (4) detail pořadatele
 * s příznakem ručního ověření ARES, (5) checkout nové akce bez volby krypto.
 *
 *   APP=http://localhost:3200 OWNER_URL=postgresql://... OUT=../logs/r7 node scripts/cdp-shot-r7.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const APP = process.env.APP ?? 'http://localhost:3200';
const OUT = process.env.OUT ?? '../logs/r7';
const ts = Date.now();
const PW = 'Kolo7-Vizual-2026';
const pool = new pg.Pool({ connectionString: process.env.OWNER_URL, max: 3 });
const q = (s, p = []) => pool.query(s, p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiters = new Map(); this.events = []; ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && this.waiters.has(m.id)) { this.waiters.get(m.id)(m); this.waiters.delete(m.id); } else if (m.method) this.events.push(m); }; }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res) => this.waiters.set(id, res)); }
  async waitEvent(method, timeout = 15000) { const start = Date.now(); while (Date.now() - start < timeout) { const i = this.events.findIndex((e) => e.method === method); if (i >= 0) return this.events.splice(i, 1)[0]; await sleep(50); } return null; }
}

async function user(email, { platformAdmin = false } = {}) {
  const hash = await bcrypt.hash(PW, 10);
  const r = await q(`INSERT INTO identity.users (email, name, password_hash, is_platform_admin, gdpr_consent_at, email_verified_at, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, now(), now(), now(), now()) RETURNING id`, [email, email.split('@')[0], hash, platformAdmin]);
  return r.rows[0].id;
}

async function login(email) {
  const r = await fetch(`${APP}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.77.0.${Math.floor(Math.random() * 250) + 1}` }, body: JSON.stringify({ email, password: PW }) });
  const j = await r.json();
  if (!j.accessToken) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(j)}`);
  return j.accessToken;
}

async function shoot(cdp, { token, url, out, settle = 6000, probe }) {
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCookies');
  if (token) {
    await cdp.send('Network.setCookie', { name: 'accessToken', value: token, url: APP, path: '/' });
    await cdp.send('Page.navigate', { url: `${APP}/robots.txt` });
    await cdp.waitEvent('Page.loadEventFired');
    await cdp.send('Runtime.evaluate', { expression: `localStorage.setItem('accessToken', ${JSON.stringify(token)})` });
  }
  await cdp.send('Page.navigate', { url });
  await cdp.waitEvent('Page.loadEventFired');
  await sleep(settle);
  const p = probe ? (await cdp.send('Runtime.evaluate', { expression: probe, awaitPromise: true, returnByValue: true }))?.result?.value : '';
  const { result } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${OUT}/${out}`, Buffer.from(result.data, 'base64'));
  console.log(`📸 ${out} ${p ?? ''}`);
  return p;
}

async function main() {
  // ── data ──
  const adminEmail = `r7admin${ts}@fix.test`;
  await user(adminEmail, { platformAdmin: true });
  const ownerEmail = `r7owner${ts}@fix.test`;
  const ownerId = await user(ownerEmail);
  const promoterId = (await q(
    `INSERT INTO platform.promoters (name, email, contact_email, slug, status, locale, vat_payer, company_dic, company_ico, iban,
            ares_check_status, manual_verification_required, created_at, updated_at)
     VALUES ($1, $2, $2, $3, 'active', 'cs', true, 'CZ27074358', '27074358', 'CZ6508000000192000145399', 'unavailable', true, now(), now())
     RETURNING id`, [`Divadlo Vizuál ${ts}`, ownerEmail, `vizual-${ts}`])).rows[0].id;
  await q(`INSERT INTO platform.promoter_members (promoter_id, user_id, role, created_at, updated_at) VALUES ($1, $2, 'owner', now(), now())`, [promoterId, ownerId]);
  const venueId = (await q(`INSERT INTO catalog.venues (name, city, country, capacity) VALUES ($1, 'Praha', 'CZ', 200) RETURNING id`, [`Sál ${ts}`])).rows[0].id;
  const mkEvent = async (title, salesEnd) => {
    const ev = (await q(
      `INSERT INTO catalog.events (organizer_id, promoter_id, venue_id, title, slug, status, event_type, date_start, date_end, sales_end_at, currency, created_at, updated_at)
       VALUES ($1, $1, $2, $3, $4, 'published', 'concert', now() + interval '10 days', now() + interval '10 days 3 hours', $5, 'CZK', now(), now()) RETURNING id, slug`,
      [promoterId, venueId, title, `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${ts}`, salesEnd])).rows[0];
    await q(`INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, visibility, vat_rate_code)
             VALUES ($1, 'Vstupné', 'standing', 35000, 100, 100, 'public', 'CZ_REDUCED')`, [ev.id]);
    return ev;
  };
  const closed = await mkEvent('Uzavreny prodej', new Date(Date.now() - 3600_000).toISOString());
  const open = await mkEvent('Otevreny prodej', null);
  const tt = (await q(`SELECT id FROM catalog.ticket_types WHERE event_id=$1`, [open.id])).rows[0].id;
  await q(`INSERT INTO platform.payouts (promoter_id, period_from, period_to, gross_revenue, platform_fees, net_payout, status, payout_cycle, currency)
           VALUES ($1, now() - interval '30 days', now() - interval '1 day', 1200000, 30000, 1170000, 'awaiting_manual_transfer', 'monthly', 'CZK')`, [promoterId]);
  console.log('data: promotér', promoterId, '| uzavřená akce', closed.id, '| otevřená', open.id);

  const adminTok = await login(adminEmail);
  const ownerTok = await login(ownerEmail);

  // ── Chrome ──
  const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9337', '--window-size=1300,1400', `--user-data-dir=${process.env.TEMP}/cdp-r7-${ts}`, 'about:blank'], { stdio: 'ignore' });
  let tgt = null;
  for (let i = 0; i < 40 && !tgt; i++) { await sleep(500); try { tgt = (await (await fetch('http://127.0.0.1:9337/json')).json()).find((t) => t.type === 'page'); } catch { /* startuje */ } }
  if (!tgt) throw new Error('Chrome CDP nenastartoval');
  const ws = new WebSocket(tgt.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const results = {};
  results.salesClosed = await shoot(cdp, { url: `${APP}/cs/events/${closed.id}`, out: 'Z_vis_1_prodej_ukoncen.png',
    probe: `(()=>{const el=document.querySelector('[data-testid=sales-closed]');return el?'sales-closed: '+el.innerText.trim().slice(0,60):'NO sales-closed; '+document.body.innerText.slice(0,120)})()` });
  results.ownerPayouts = await shoot(cdp, { token: ownerTok, url: `${APP}/admin/payouts`, out: 'Z_vis_2_admin_vyplaty.png',
    probe: `(()=>{const t=document.body.innerText;return [t.includes('Čeká na ruční převod')?'awaiting-shown':'NO-awaiting', t.includes('CZ6508000000192000145399')?'iban-ok':'NO-iban', t.includes('CZ65 0800 0000 0019 2000 1450')?'FAKE-IBAN!':'no-fake-iban'].join(' ')})()` });
  results.platformPayouts = await shoot(cdp, { token: adminTok, url: `${APP}/platform/payouts`, out: 'Z_vis_3_platform_vyplaty.png',
    probe: `(()=>{const t=document.body.innerText;return [document.querySelectorAll('[data-testid=payout-awaiting]').length+' awaiting', t.includes('Potvrdit převod')?'confirm-btn':'NO-btn'].join(' ')})()` });
  results.promoterDetail = await shoot(cdp, { token: adminTok, url: `${APP}/platform/promoters/${promoterId}`, out: 'Z_vis_4_platform_porada_ares.png',
    probe: `(()=>document.querySelector('[data-testid=manual-verification]')?'manual-badge':'NO-badge')()` });
  results.checkout = await shoot(cdp, { url: `${APP}/cs/checkout?eventId=${open.id}&ticketTypeId=${tt}&quantity=1`, out: 'Z_vis_5_checkout_bez_krypta.png',
    probe: `(()=>{const t=document.body.innerText;return [document.querySelector('input[value=crypto]')?'CRYPTO-SHOWN':'no-crypto', document.querySelector('input[value=gopay]')?'gopay-ok':'NO-gopay'].join(' ')})()` });

  proc.kill();
  writeFileSync(`${OUT}/Z_vis_results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
main().then(() => pool.end()).catch(async (e) => { console.error('💥', e.message); await pool.end(); process.exit(1); });
