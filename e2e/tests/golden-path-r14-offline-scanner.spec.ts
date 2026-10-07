/**
 * Kolo 14 / krok 1 — skener bez internetu (C-50), Chromium s emulací offline (context.setOffline).
 *
 *  1 stažení seznamu vstupenek termínu do zařízení + kdy byl stažen
 *  2 offline: platná vpuštěna; použitá (online i offline na tomtéž zařízení) odmítnuta; stornovaná odmítnuta; jiný termín
 *    odmítnut; kategorie s průkazem hlášena; rotující QR i tištěný TXP2 podle pravidel online (podpis, povinné TOTP)
 *  3 po obnovení sítě se offline odbavení odešlou idempotentně a zapíšou do scan_logs
 *  4 dva skenery offline tutéž vstupenku → po synchronizaci druhé odbavení „duplicate", počet v reportu termínu
 *  5 zavření a znovuotevření prohlížeče offline: seznam i neodeslaná odbavení přežijí (stránka se otevře z cache)
 *  6 vstupenka stornovaná po stažení seznamu: online odmítnuta vždy, offline jen se seznamem staženým po stornu
 *
 * Prostředí: `next start` nad DB z `create.sh --local` (demo agentura, logs/r14/reset_demo.sh), simulátor GoPay :3998.
 * Vstupenky vznikají přes pokladnu (POS) vlastníka — skutečné TOTP tajemství a skutečný tok vystavení.
 */
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const OWNER_URL = process.env.AUDIT_OWNER_URL ?? 'postgresql://neondb_owner:fixowner@localhost:55632/r14demo';
const OWNER = { email: 'demo@tixly-staging.test', pass: 'Demo2026!heslo' };
const FIXTURE = process.env.R14_FIXTURE ?? ''; // soubor s daty běhu — restart workeru po chybě nesmí prodávat znovu
const RUN = Date.now().toString(36);
const PASS = 'Ux2026!heslo';
const RUN_IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
const ENV_FILE = join(__dirname, '..', '..', 'nextjs-boilerplate', 'fix.app.env');
const JWT_SECRET = /^JWT_SECRET=(.*)$/m.exec(readFileSync(ENV_FILE, 'utf8'))?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
const PLACEHOLDER = '8a4f7b2e-… / tixly:…:123456 / TXP2.…';

test.describe.configure({ mode: 'default' }); // body jsou nezávislé (vlastní kontext a vstupenky)
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

let db: pg.Client;
const q = async <R = Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<R[]> => (await db.query(sql, p)).rows as R[];
const S = {
  promoterId: '', rBrno: '', rOstrava: '', hBrno: '', gate: `vstup-off-${RUN}@agentura.test`,
  t: {} as Record<string, { id: string; secret: Buffer; eventId: string }>,
};

// ── RFC 4648 base32, RFC 6238 TOTP, TXP2 (stejné algoritmy jako lib/totp/verify a lib/tickets/print-token) ──
function base32Decode(s: string): Buffer {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0; let val = 0; const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    val = (val << 5) | A.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret: Buffer, at = Date.now()): string {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac('sha1', secret).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}
const uuidBytes = (u: string) => Buffer.from(u.replace(/-/g, ''), 'hex');
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function txp2(ticketId: string, eventId: string, forge = false): string {
  const t = uuidBytes(ticketId);
  const sig = createHmac('sha256', Buffer.from(forge ? 'spatny-klic' : JWT_SECRET, 'utf8')).update('TXP2').update(t).update(uuidBytes(eventId)).digest().subarray(0, 12);
  return `TXP2.${b64url(Buffer.concat([t, sig]))}`;
}

async function newCtx(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  await prepCtx(ctx);
  return { ctx, page: await ctx.newPage() };
}
async function prepCtx(ctx: BrowserContext): Promise<void> {
  await ctx.setExtraHTTPHeaders({ 'x-real-ip': RUN_IP });
  await ctx.addInitScript(() => { try { window.localStorage.setItem('tixly.cookie-consent', JSON.stringify({ essential: true, analytics: false, marketing: false, decidedAt: new Date().toISOString() })); } catch { /* */ } });
}
async function login(page: Page, email: string, pass: string): Promise<void> {
  await page.goto('/cs/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Heslo').fill(pass);
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/auth/login')), page.getByRole('button', { name: /^Přihlásit$/ }).click()]);
  await page.waitForURL(/\/admin(?!\/?login)/, { timeout: 30_000 });
}
async function api(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(async ({ method, path, body }) => {
    const t = localStorage.getItem('accessToken') ?? '';
    const r = await fetch(path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> };
  }, { method, path, body });
}
/** Otevře skener s branou na termín a stáhne offline seznam. */
async function openGate(page: Page, eventId: string, download = true): Promise<void> {
  await page.goto('/admin/scanner');
  const change = page.getByRole('button', { name: 'Změnit' });
  if (await change.isVisible({ timeout: 3000 }).catch(() => false)) await change.click();
  const sel = page.locator('select').first();
  await sel.locator(`option[value="${eventId}"]`).waitFor({ state: 'attached' });
  await sel.selectOption(eventId);
  const done = page.getByRole('button', { name: /^Hotovo$/ });
  if (await done.isVisible().catch(() => false)) await done.click();
  if (download) {
    await page.getByRole('button', { name: /Stáhnout offline seznam|Aktualizovat/ }).click();
    await expect(page.getByText(/Offline seznam: .* lístků · staženo/)).toBeVisible();
  }
}
async function scan(page: Page, raw: string): Promise<string> {
  const input = page.getByPlaceholder(PLACEHOLDER);
  await input.fill(raw);
  await page.getByRole('button', { name: /Validovat lístek|Validuji/ }).first().click();
  await expect(page.getByRole('button', { name: 'Validovat lístek' })).toBeEnabled();
  const card = page.locator('div.rounded-lg.border').filter({ has: page.getByText('Výsledek', { exact: true }) }).last();
  await expect(card.locator('div.rounded-md.border').first()).toBeVisible();
  return (await card.innerText()).replace(/\s+/g, ' ').trim();
}
/** Prodá místa přes POS (vlastník) a vrátí vstupenky s TOTP tajemstvím. */
async function posSell(page: Page, eventId: string, n: number): Promise<Array<{ id: string; secret: Buffer }>> {
  const ev = (await api(page, 'GET', '/api/admin/pos/events')).json.events as Array<{ id: string; ticketTypes: Array<{ id: string; isSeated: boolean; remainingQty: number }> }>;
  const tt = ev.find((e) => e.id === eventId)!.ticketTypes.find((t) => t.isSeated && t.remainingQty > 0)!;
  const seats = await q<{ id: string }>(`SELECT id FROM catalog.event_seats WHERE event_id = $1 AND ticket_type_id = $2 AND status = 'available' ORDER BY row::int DESC, seat_number::int DESC LIMIT $3`, [eventId, tt.id, n]);
  const r = await api(page, 'POST', '/api/admin/pos/sale', { eventId, ticketTypeId: tt.id, quantity: n, seatIds: seats.map((s) => s.id), paymentMethod: 'cash' });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return (r.json.tickets as Array<{ ticketId: string; totpSecretBase32: string }>).map((t) => ({ id: t.ticketId, secret: base32Decode(t.totpSecretBase32) }));
}
async function scanLogs(ticketId: string): Promise<Array<{ scan_result: string; offline: boolean; denied_reason: string | null }>> {
  return q(`SELECT scan_result, offline, denied_reason FROM tickets.scan_logs WHERE ticket_id = $1 ORDER BY id`, [ticketId]);
}

test.beforeAll(async ({ browser, playwright }) => {
  test.setTimeout(180_000);
  expect(JWT_SECRET, 'JWT_SECRET z fix.app.env').not.toBe('');
  db = new pg.Client({ connectionString: OWNER_URL });
  await db.connect();
  S.promoterId = (await q<{ id: string }>(`SELECT p.id FROM platform.promoters p JOIN platform.promoter_members m ON m.promoter_id = p.id JOIN identity.users u ON u.id = m.user_id WHERE u.email = $1`, [OWNER.email]))[0].id;
  const terms = await q<{ id: string; title: string; city: string }>(`SELECT e.id, e.title, v.city FROM catalog.events e JOIN catalog.venues v ON v.id = e.venue_id WHERE e.promoter_id = $1`, [S.promoterId]);
  S.rBrno = terms.find((t) => t.title === 'Racek' && t.city === 'Brno')!.id;
  S.rOstrava = terms.find((t) => t.title === 'Racek' && t.city === 'Ostrava')!.id;
  S.hBrno = terms.find((t) => t.title === 'Hamlet' && t.city === 'Brno')!.id;
  if (FIXTURE && existsSync(FIXTURE)) {
    const f = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { gate: string; t: Record<string, { id: string; secret: string; eventId: string }> };
    S.gate = f.gate;
    for (const [k, v] of Object.entries(f.t)) S.t[k] = { ...v, secret: Buffer.from(v.secret, 'hex') };
    return;
  }
  // Racek Brno: rotating_24h, termín za > 24 h → holé UUID stačí, TXP2 platí. Hamlet Brno: rotating_only → TOTP povinné.
  await db.query(`UPDATE catalog.events SET qr_policy = 'rotating_24h' WHERE id = $1`, [S.rBrno]);
  await db.query(`UPDATE catalog.events SET qr_policy = 'rotating_only' WHERE id = $1`, [S.hBrno]);
  const a = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-real-ip': RUN_IP } });
  const reg = await a.post('/api/auth/register', { data: { email: S.gate, password: PASS, name: 'Uvaděčka' }, headers: { origin: BASE } });
  expect(reg.status(), await reg.text()).toBe(200);
  await db.query(`INSERT INTO platform.promoter_members (promoter_id, user_id, role) SELECT $1, id, 'staff' FROM identity.users WHERE email = $2`, [S.promoterId, S.gate]);
  await a.dispose();
  // vstupenky
  const { ctx, page } = await newCtx(browser);
  await login(page, OWNER.email, OWNER.pass);
  const names = ['valid', 'usedOnline', 'revoked', 'ztp', 'txp', 'twoDev', 'stale', 'persist1', 'persist2', 'idem', 'used1', 'sync1', 'syncRev', 'stale6'];
  const rb = await posSell(page, S.rBrno, names.length);
  names.forEach((n, i) => { S.t[n] = { ...rb[i], eventId: S.rBrno }; });
  const ro = await posSell(page, S.rOstrava, 1);
  S.t.other = { ...ro[0], eventId: S.rOstrava };
  const hb = await posSell(page, S.hBrno, 3);
  ['rotOk', 'rotBare', 'rotWrong'].forEach((n, i) => { S.t[n] = { ...hb[i], eventId: S.hBrno }; });
  // kategorie s průkazem, storno před stažením seznamu
  await db.query(`UPDATE tickets.tickets SET price_category_name = 'ZTP/P', proof_required_label = 'ZTP/P' WHERE id = $1`, [S.t.ztp.id]);
  await db.query(`UPDATE tickets.tickets SET status = 'revoked', revoked_at = now() WHERE id = ANY($1::uuid[])`, [[S.t.revoked.id, S.t.syncRev.id]]);
  await db.query(`UPDATE tickets.tickets SET status = 'used', used_at = now() WHERE id = $1`, [S.t.usedOnline.id]); // „použitá dříve online"
  await ctx.close();
  if (FIXTURE) writeFileSync(FIXTURE, JSON.stringify({ gate: S.gate, t: Object.fromEntries(Object.entries(S.t).map(([k, v]) => [k, { ...v, secret: v.secret.toString('hex') }])) }));
});
test.afterAll(async () => { await db?.end(); });

test('bod 1: stažení seznamu vstupenek termínu do zařízení a kdy byl stažen', async ({ browser }) => {
  const { ctx, page: gatePage } = await newCtx(browser);
  await login(gatePage, S.gate, PASS);
  // online odbavení před stažením seznamu
  await openGate(gatePage, S.rBrno, false);
  expect(await scan(gatePage, S.t.used1.id)).toMatch(/Vstup povolen/);
  await gatePage.getByRole('button', { name: /Stáhnout offline seznam|Aktualizovat/ }).click();
  const meta = gatePage.getByText(/Offline seznam: .* lístků · staženo/);
  await expect(meta).toBeVisible();
  const n = Number(((await meta.innerText()).match(/Offline seznam: ([\d\s ]+) lístků/)?.[1] ?? '').replace(/\s/g, ''));
  const db_ = (await q<{ n: number }>(`SELECT count(*)::int n FROM tickets.tickets t JOIN orders.orders o ON o.id = t.order_id WHERE o.event_id = $1 AND t.status IN ('valid','used','revoked')`, [S.rBrno]))[0].n;
  expect(n).toBe(db_);
  expect(await meta.innerText()).toMatch(/staženo \d{1,2}\. \d{1,2}\. \d{4}/);
  await ctx.close();
});

test('bod 2: offline — pravidla jako online', async ({ browser }) => {
  const { ctx: gateCtx, page: gatePage } = await newCtx(browser);
  await login(gatePage, S.gate, PASS);
  await openGate(gatePage, S.rBrno);
  await gateCtx.setOffline(true);
  await expect(gatePage.getByText(/Offline — skeny jdou do lokální fronty/)).toBeVisible();
  // platná
  expect(await scan(gatePage, S.t.valid.id)).toMatch(/Vstup povolen/);
  // tatáž znovu na tomtéž zařízení
  expect(await scan(gatePage, S.t.valid.id)).toMatch(/Lístek už byl použit/);
  // použitá dříve online
  expect(await scan(gatePage, S.t.usedOnline.id)).toMatch(/Lístek už byl použit/);
  // stornovaná
  expect(await scan(gatePage, S.t.revoked.id)).toMatch(/Lístek zrušen/);
  // jiný termín
  const other = await scan(gatePage, S.t.other.id);
  expect(other).not.toMatch(/Vstup povolen/);
  expect(other).toMatch(/Lístek na jinou akci|Lístek nenalezen/);
  // kategorie s průkazem
  const ztp = await scan(gatePage, S.t.ztp.id);
  expect(ztp).toMatch(/Vstup povolen/);
  expect(ztp).toMatch(/Ověřit průkaz: ZTP\/P/);
  // tištěný TXP2: platný podpis vpuštěn, padělaný podpis odmítnut (online: invalid_token)
  expect(await scan(gatePage, txp2(S.t.stale6.id, S.rBrno, true))).toMatch(/Neplatný kód vstupenky/);
  expect(await scan(gatePage, txp2(S.t.txp.id, S.rBrno))).toMatch(/Vstup povolen/);
  // rotující QR (Hamlet Brno, rotating_only): manifest stažen online předem
  await gateCtx.setOffline(false);
  await openGate(gatePage, S.hBrno);
  await gateCtx.setOffline(true);
  await expect(gatePage.getByText(/Offline — skeny jdou do lokální fronty/)).toBeVisible();
  const bare = await scan(gatePage, S.t.rotBare.id);
  expect(bare).not.toMatch(/Vstup povolen/);
  expect(bare).toMatch(/rotující QR/);
  expect(await scan(gatePage, `tixly:${S.t.rotWrong.id}:${totp(S.t.rotWrong.secret) === '000000' ? '111111' : '000000'}`)).toMatch(/TOTP kód neodpovídá/);
  expect(await scan(gatePage, `tixly:${S.t.rotOk.id}:${totp(S.t.rotOk.secret)}`)).toMatch(/Vstup povolen/);
  // nic z toho ještě nesmí být na serveru
  expect((await q<{ status: string }>(`SELECT status FROM tickets.tickets WHERE id = $1`, [S.t.valid.id]))[0].status).toBe('valid');
  await gateCtx.close(); // fronta zaniká s kontextem — synchronizaci testuje bod 3
});

test('bod 3: po obnovení sítě se odbavení odešlou idempotentně a zapíšou do scan_logs', async ({ browser }) => {
  const { ctx: gateCtx, page: gatePage } = await newCtx(browser);
  await login(gatePage, S.gate, PASS);
  await openGate(gatePage, S.hBrno);
  await openGate(gatePage, S.rBrno);
  await gateCtx.setOffline(true);
  expect(await scan(gatePage, S.t.sync1.id)).toMatch(/Vstup povolen/);
  expect(await scan(gatePage, S.t.syncRev.id)).not.toMatch(/Vstup povolen/);
  await gateCtx.setOffline(false);
  await expect(gatePage.getByText(/čeká na sync/)).toHaveCount(0, { timeout: 30_000 });
  for (const k of ['sync1']) {
    expect((await q<{ status: string }>(`SELECT status FROM tickets.tickets WHERE id = $1`, [S.t[k].id]))[0].status, k).toBe('used');
    const logs = await scanLogs(S.t[k].id);
    expect(logs.filter((l) => l.offline && l.scan_result === 'admitted'), k).toHaveLength(1);
  }
  // odmítnuté offline skeny jsou v auditu jako odmítnuté, stav vstupenky beze změny
  expect((await scanLogs(S.t.syncRev.id)).some((l) => l.offline && l.scan_result !== 'admitted')).toBe(true);
  expect((await q<{ status: string }>(`SELECT status FROM tickets.tickets WHERE id = $1`, [S.t.syncRev.id]))[0].status).toBe('revoked');
  // idempotence: totéž odeslání dvakrát → jeden záznam
  const scanId = crypto.randomUUID();
  const body = { deviceId: `test-${RUN}`, scans: [{ clientScanId: scanId, ticketId: S.t.idem.id, eventId: S.rBrno, scannedAt: new Date().toISOString(), offlineResult: 'admitted' }] };
  const r1 = await api(gatePage, 'POST', '/api/admin/scanner/offline-sync', body);
  const r2 = await api(gatePage, 'POST', '/api/admin/scanner/offline-sync', body);
  expect(r1.status, JSON.stringify(r1.json)).toBe(200);
  expect(r2.status, JSON.stringify(r2.json)).toBe(200);
  expect((r1.json.results as Array<{ result: string }>)[0].result).toBe('admitted');
  expect((r2.json.results as Array<{ result: string; replay?: boolean }>)[0]).toMatchObject({ result: 'admitted', replay: true });
  expect(await scanLogs(S.t.idem.id)).toHaveLength(1);
  await gateCtx.close();
});

test('bod 4: dva skenery offline tutéž vstupenku → po synchronizaci duplicitní, počet v reportu', async ({ browser }) => {
  const a = await newCtx(browser); const b = await newCtx(browser);
  for (const d of [a, b]) { await login(d.page, S.gate, PASS); await openGate(d.page, S.rBrno); await d.ctx.setOffline(true); }
  for (const d of [a, b]) expect(await scan(d.page, S.t.twoDev.id)).toMatch(/Vstup povolen/);
  for (const d of [a, b]) { await d.ctx.setOffline(false); await expect(d.page.getByText(/čeká na sync/)).toHaveCount(0, { timeout: 30_000 }); }
  const logs = await scanLogs(S.t.twoDev.id);
  expect(logs.filter((l) => l.offline && l.scan_result === 'admitted')).toHaveLength(1);
  expect(logs.filter((l) => l.offline && l.scan_result === 'duplicate')).toHaveLength(1);
  await a.ctx.close(); await b.ctx.close();
  // report termínu (vlastník): počet duplicitních offline vstupů ve stávajícím souhrnu
  const own = await newCtx(browser);
  await login(own.page, OWNER.email, OWNER.pass);
  const rep = await api(own.page, 'GET', `/api/admin/theatre-reports?scope=term&eventId=${S.rBrno}`);
  expect((rep.json.totals as { offlineDuplicates?: number }).offlineDuplicates).toBe(1);
  await own.page.goto(`/admin/events/${S.rBrno}/reporty`);
  await expect(own.page.getByText(/duplicitní offline vstupy 1/)).toBeVisible();
  await own.ctx.close();
});

test('bod 5: zavření a znovuotevření prohlížeče offline — seznam i neodeslaná odbavení přežijí', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'tixly-r14-sken-'));
  const launch = async () => {
    const ctx = await chromium.launchPersistentContext(dir, { baseURL: BASE, viewport: { width: 1440, height: 900 } });
    await prepCtx(ctx);
    return ctx;
  };
  let ctx = await launch();
  let page = ctx.pages()[0] ?? await ctx.newPage();
  await login(page, S.gate, PASS);
  await openGate(page, S.rBrno);
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active != null, null, { timeout: 30_000 });
  await page.reload(); // stránka teď pod service workerem
  await expect(page.getByText(/Offline seznam: .* lístků · staženo/)).toBeVisible();
  await ctx.setOffline(true);
  await expect(page.getByText(/Offline — skeny jdou do lokální fronty/)).toBeVisible();
  expect(await scan(page, S.t.persist1.id)).toMatch(/Vstup povolen/);
  await expect(page.getByText(/1 čeká na sync/)).toBeVisible();
  await ctx.close();
  // znovu otevřít bez internetu
  ctx = await launch();
  await ctx.setOffline(true);
  page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto('/admin/scanner');
  await expect(page.getByPlaceholder(PLACEHOLDER)).toBeVisible();
  await expect(page.getByText(/Offline — skeny jdou do lokální fronty/)).toBeVisible();
  await expect(page.getByText(/1 čeká na sync/)).toBeVisible();
  await expect(page.getByText(/Offline seznam: .* lístků · staženo/)).toBeVisible();
  expect(await scan(page, S.t.persist2.id)).toMatch(/Vstup povolen/);
  expect(await scan(page, S.t.persist1.id)).toMatch(/Lístek už byl použit/);
  // síť zpět → odeslání
  await ctx.setOffline(false);
  await expect(page.getByText(/čeká na sync/)).toHaveCount(0, { timeout: 30_000 });
  for (const k of ['persist1', 'persist2']) expect((await q<{ status: string }>(`SELECT status FROM tickets.tickets WHERE id = $1`, [S.t[k].id]))[0].status, k).toBe('used');
  await ctx.close();
});

test('bod 6: storno po stažení seznamu — online vždy odmítnuto, offline jen se seznamem staženým po stornu', async ({ browser }) => {
  const { ctx, page } = await newCtx(browser);
  await login(page, S.gate, PASS);
  await openGate(page, S.rBrno); // seznam PŘED stornem
  await db.query(`UPDATE tickets.tickets SET status = 'revoked', revoked_at = now() WHERE id = $1`, [S.t.stale.id]);
  // online: odmítnuto
  expect(await scan(page, S.t.stale.id)).toMatch(/Lístek zrušen/);
  // offline se starým seznamem: zařízení storno nezná → vpustí (popsáno v příručce)
  await ctx.setOffline(true);
  expect(await scan(page, S.t.stale.id)).toMatch(/Vstup povolen/);
  await ctx.setOffline(false);
  await expect(page.getByText(/čeká na sync/)).toHaveCount(0, { timeout: 30_000 });
  // server odbavení zaznamená jako odmítnuté (storno), vstupenka zůstává stornovaná
  const logs = await scanLogs(S.t.stale.id);
  expect(logs.some((l) => l.offline && l.scan_result === 'denied' && l.denied_reason === 'revoked')).toBe(true);
  expect((await q<{ status: string }>(`SELECT status FROM tickets.tickets WHERE id = $1`, [S.t.stale.id]))[0].status).toBe('revoked');
  // seznam stažený PO stornu → offline odmítnuto
  await page.getByRole('button', { name: /Aktualizovat/ }).click();
  await ctx.setOffline(true);
  expect(await scan(page, S.t.stale.id)).toMatch(/Lístek zrušen/);
  await ctx.close();
});
