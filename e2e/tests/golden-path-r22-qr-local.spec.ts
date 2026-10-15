/**
 * Kolo 22 / krok 1 — žádné tajemství na api.qrserver.com (QR se generuje lokálně v prohlížeči).
 *
 * Vada: dvě klientské stránky skládaly URL obrázku `https://api.qrserver.com/v1/create-qr-code/?…&data=<tajemství>`,
 * takže prohlížeč posílal tajemství třetí straně:
 *   - /admin/settings → Zabezpečení → Zapnout 2FA: `data=` = otpauth URL se TOTP secretem administrátora;
 *   - /cs/gift/<token> po uplatnění dárku: `data=` = qrPayload vstupenky (platný vstup na akci).
 *
 * Běží proti lokálnímu `next start` (BASE_URL, výchozí http://localhost:3200) nad demo DB z migrací (scripts/staging/create.sh
 * --local, aplikace pod tixly_app + RLS), simulátor GoPay :3998. Nic se nemockuje: 2FA setup/verify i nákup dárku, platba
 * a uplatnění jdou přes skutečné API aplikace. Každý požadavek prohlížeče na jiného hostitele než localhost/127.0.0.1
 * se zaznamená a zahodí (route.abort()) dřív, než odejde do sítě — pojistka sítě, ne mock.
 *
 *   (a1) žádný zaznamenaný požadavek mimo localhost nenese otpauth ani secretBase32 (ani URL-kódovaně), žádný na api.qrserver.com
 *   (a2) QR `alt="QR kód 2FA"` (třídy h-44 w-44) má src data:image/png;base64 = QRCode.toDataURL(otpauth, { width: 180, margin: 4 })
 *   (a3) kód z secretBase32 (otplib) → POST /api/admin/2fa/verify 200, zobrazí se záložní kódy
 *   (b1) žádný zaznamenaný požadavek mimo localhost nenese qrPayload (ani jeho secret) ani token dárku, žádný na api.qrserver.com
 *   (b2) QR `alt="Vstupenka QR"` 220×220 má src data:image/png;base64 = QRCode.toDataURL(qrPayload, { width: 220, margin: 4 })
 * Shoda obrázku: prohlížeč kóduje PNG přes canvas, Node přes pngjs — bajty PNG se liší kodérem, proto se porovnávají
 * dekódované pixely (RGBA) a rozměry; shoda řetězců se jen vypíše.
 * Pojistka proti průchodu naprázdno: bez otpauth / qrPayload z odpovědi API nebo bez vykresleného QR test selže.
 * Hodnoty tajemství se nevypisují (max. 4 znaky). Snímky (R22_SHOTS) mají ruční kód a QR zamaskované.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const SHOTS = process.env.R22_SHOTS ?? '';
const SHOT_TAG = process.env.R22_SHOT_TAG ?? 'run';
// administrátor ze seedu (scripts/staging/create.sh --local, reset_demo.sh)
const OWNER = { email: 'demo@tixly-staging.test', pass: 'Demo2026!heslo' };
// demo termín Hamlet, Divadlo Petra Bezruče (scripts/staging/seed-demo.sql) — inscenace Hamlet má dva termíny (503, 504)
const TERM = '00000000-0000-4000-a000-000000000504';
const RUN = Date.now().toString(36);
const ipFor = (): string => `10.${16 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
const mask = (t: string): string => `${t.slice(0, 4)}…`;

// knihovny aplikace (žádné nové závislosti): qrcode jako v klientských komponentách, otplib, pngjs (závislost qrcode)
const appRequire = createRequire(join(__dirname, '..', '..', 'nextjs-boilerplate', 'package.json'));
const QRCode = appRequire('qrcode') as { toDataURL: (text: string, opts: { width: number; margin: number }) => Promise<string> };
const { generateSync } = appRequire('otplib') as { generateSync: (o: { secret: string; epoch?: number }) => string };
const { PNG } = appRequire('pngjs') as { PNG: { sync: { read: (b: Buffer) => { width: number; height: number; data: Buffer } } } };

const log: string[] = [];
const note = (s: string): void => { log.push(s); console.log(`[r22] ${s}`); };

interface Outbound { host: string; path: string; url: string; body: string }

/** Kontext prohlížeče: požadavky mimo localhost/127.0.0.1 se zaznamenají a zahodí (route.abort) před odesláním. */
async function guardedContext(browser: Browser): Promise<{ ctx: BrowserContext; page: Page; out: Outbound[] }> {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  await ctx.setExtraHTTPHeaders({ 'x-real-ip': ipFor() });
  await ctx.addInitScript(() => { try { window.localStorage.setItem('tixly.cookie-consent', JSON.stringify({ essential: true, analytics: false, marketing: false, decidedAt: '2026-10-15T00:00:00.000Z' })); } catch { /* */ } });
  const out: Outbound[] = [];
  await ctx.route('**/*', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return route.continue();
    out.push({ host: u.host, path: u.pathname, url: req.url(), body: req.postData() ?? '' });
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => void d.dismiss());
  return { ctx, page, out };
}

/** Varianty hodnoty, jak by mohla odejít v URL: syrová, URL-kódovaná (1× i 2×), s mezerami jako +. */
const variants = (v: string): string[] =>
  [...new Set([v, encodeURIComponent(v), encodeURIComponent(encodeURIComponent(v)), encodeURIComponent(v).replace(/%20/g, '+')])];

/** Souhrn zahozených požadavků: podle hostitele, a kolik neslo některé z tajemství (jen názvy, žádné hodnoty). */
function summarize(label: string, out: Outbound[], secrets: Record<string, string>): { withSecret: number; qrserver: number } {
  const byHost: Record<string, number> = {};
  let withSecret = 0;
  for (const r of out) {
    byHost[r.host] = (byHost[r.host] ?? 0) + 1;
    const hit = Object.entries(secrets).filter(([, v]) => v && variants(v).some((x) => r.url.includes(x) || r.body.includes(x))).map(([k]) => k);
    if (hit.length) withSecret += 1;
    note(`${label} zahozeno: ${r.host}${r.path} — nese: ${hit.length ? hit.join(', ') : 'nic z tajemství'}`);
  }
  const qrserver = out.filter((r) => r.host === 'api.qrserver.com').length;
  note(`${label} zahozených požadavků mimo localhost: ${out.length}; podle hostitele: ${JSON.stringify(byHost)}; s tajemstvím: ${withSecret}; na api.qrserver.com: ${qrserver}`);
  return { withSecret, qrserver };
}

/** Porovná src obrázku s QRCode.toDataURL z knihovny aplikace: dekódované pixely a rozměry (viz hlavička). */
async function compareQr(label: string, src: string, text: string, width: number): Promise<{ pixelsEqual: boolean; w: number; h: number }> {
  const want = await QRCode.toDataURL(text, { width, margin: 4 });
  const prefix = 'data:image/png;base64,';
  if (!src.startsWith(prefix)) {
    note(`${label} src není data:image/png;base64 (začátek: ${src.slice(0, 40)}…)`);
    return { pixelsEqual: false, w: 0, h: 0 };
  }
  const got = PNG.sync.read(Buffer.from(src.slice(prefix.length), 'base64'));
  const exp = PNG.sync.read(Buffer.from(want.slice(prefix.length), 'base64'));
  const pixelsEqual = got.width === exp.width && got.height === exp.height && Buffer.compare(got.data, exp.data) === 0;
  note(`${label} src data:image/png ${got.width}×${got.height}; očekáváno toDataURL(text, { width: ${width}, margin: 4 }) ${exp.width}×${exp.height}; pixely RGBA shodné: ${pixelsEqual}; řetězec shodný: ${src === want}`);
  return { pixelsEqual, w: got.width, h: got.height };
}

/** Počká, až obrázek doběhne (načten, nebo chyba načtení), a vrátí jeho stav a umístění. */
async function imgState(img: Locator): Promise<{ src: string; cls: string; complete: boolean; nw: number; nh: number; box: { x: number; y: number; width: number; height: number } | null; wAttr: string | null; hAttr: string | null }> {
  await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.complete), { timeout: 20_000 }).toBe(true);
  const s = await img.evaluate((el: HTMLImageElement) => ({ src: el.getAttribute('src') ?? '', cls: el.className, complete: el.complete, nw: el.naturalWidth, nh: el.naturalHeight, wAttr: el.getAttribute('width'), hAttr: el.getAttribute('height') }));
  return { ...s, box: await img.boundingBox() };
}

async function shot(page: Page, name: string, masks: Locator[]): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `1_${SHOT_TAG}_${name}.png`), fullPage: false, mask: masks, maskColor: '#ff00ff' });
  note(`snímek ${SHOT_TAG}_${name}.png (ruční kód a QR zamaskovány #ff00ff)`);
}

test('(a) 2FA: QR otpauth lokálně, nic nejde na api.qrserver.com, aktivace 2FA projde', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page, out } = await guardedContext(browser);

  // přihlášení administrátora ze seedu (skutečné /api/auth/login)
  await page.goto('/cs/login', { waitUntil: 'networkidle' });
  await page.locator('input[type="email"]').first().fill(OWNER.email);
  await page.getByLabel('Heslo').fill(OWNER.pass);
  const [login] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST', { timeout: 60_000 }),
    page.getByRole('button', { name: /^Přihlásit$/ }).click(),
  ]);
  expect(login.status(), 'přihlášení administrátora').toBe(200);
  await page.waitForURL(/\/admin/, { timeout: 60_000 });

  // /admin/settings → Zabezpečení → Zapnout 2FA (skutečné POST /api/admin/2fa/setup)
  await page.goto('/admin/settings', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Zabezpečení' }).click();
  const [setup] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/admin/2fa/setup') && r.request().method() === 'POST', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Zapnout 2FA' }).click(),
  ]);
  expect(setup.status(), 'POST /api/admin/2fa/setup').toBe(200);
  const { otpauth, secretBase32 } = (await setup.json()) as { otpauth?: string; secretBase32?: string };
  // pojistka proti průchodu naprázdno
  expect(otpauth ?? '', 'otpauth z odpovědi API').toMatch(/^otpauth:\/\/totp\//);
  expect((secretBase32 ?? '').length, 'secretBase32 z odpovědi API').toBeGreaterThanOrEqual(16);
  note(`(a) otpauth ${mask(otpauth!)} (délka ${otpauth!.length}), secretBase32 ${mask(secretBase32!)} (délka ${secretBase32!.length})`);

  const img = page.locator('img[alt="QR kód 2FA"]');
  await expect(img, 'QR kód 2FA vykreslen').toBeVisible({ timeout: 20_000 });
  const st = await imgState(img);
  note(`(a2) img alt="QR kód 2FA": class="${st.cls}", complete=${st.complete}, natural ${st.nw}×${st.nh}, box ${JSON.stringify(st.box)}`);
  await shot(page, 'a2_2fa', [img, page.locator('code', { hasText: secretBase32! })]);

  // (a1)
  const a1 = summarize('(a1)', out, { otpauth: otpauth!, secretBase32: secretBase32! });
  expect.soft(a1.withSecret, '(a1) požadavky mimo localhost s otpauth/secretBase32').toBe(0);
  expect.soft(a1.qrserver, '(a1) požadavky na api.qrserver.com').toBe(0);

  // (a2)
  expect.soft(st.cls, '(a2) třídy beze změny').toBe('h-44 w-44');
  expect.soft(st.src.startsWith('data:image/png;base64,'), '(a2) src = data:image/png;base64').toBe(true);
  const c = await compareQr('(a2)', st.src, otpauth!, 180);
  expect.soft(c.pixelsEqual, '(a2) obrázek = QRCode.toDataURL(otpauth, { width: 180, margin: 4 })').toBe(true);
  expect.soft([st.nw, st.nh], '(a2) vykreslený obrázek 180×180').toEqual([180, 180]);

  // (a3) kód z secretBase32 → skutečné POST /api/admin/2fa/verify
  await page.locator('#totp-code').fill(generateSync({ secret: secretBase32! }));
  const [verify] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/admin/2fa/verify') && r.request().method() === 'POST', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Ověřit a aktivovat' }).click(),
  ]);
  note(`(a3) POST /api/admin/2fa/verify → ${verify.status()}`);
  expect.soft(verify.status(), '(a3) verify 200').toBe(200);
  await expect.soft(page.getByText('2FA aktivováno. Ulož si těchto 10 záložních kódů.'), '(a3) záložní kódy zobrazeny').toBeVisible();
  await expect.soft(page.locator('pre.font-mono'), '(a3) blok záložních kódů').toBeVisible();

  // úklid: 2FA administrátora ze seedu zase vypnout (skutečné POST /api/admin/2fa/disable, kód dalšího kroku)
  const disable = await page.evaluate(async (code) => {
    const t = localStorage.getItem('accessToken');
    const r = await fetch('/api/admin/2fa/disable', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ code }) });
    return r.status;
  }, generateSync({ secret: secretBase32!, epoch: Math.floor(Date.now() / 1000) + 30 }));
  note(`(a) úklid: POST /api/admin/2fa/disable → ${disable}`);
  await ctx.close();
});

test('(b) dárek: QR vstupenky lokálně, nic nejde na api.qrserver.com', async ({ browser }) => {
  test.setTimeout(240_000);
  const { ctx, page, out } = await guardedContext(browser);
  const buyer = `r22-darce-${RUN}@test.cz`;
  const recipient = `r22-obdarovany-${RUN}@test.cz`;

  // volné místo termínu ze skutečného API (stejný zdroj jako plánek sálu) a jeho podržení (POST …/seats/hold, jako SeatPicker)
  const seatsRes = await ctx.request.get(`${BASE}/api/events/${TERM}/seats`);
  expect(seatsRes.status(), 'GET seats').toBe(200);
  const { seats } = (await seatsRes.json()) as { seats: Array<{ id: string; status: string; ttId: string; sector: string; row: string; num: string }> };
  const free = seats.filter((s) => s.status === 'available');
  expect(free.length, 'volná místa').toBeGreaterThan(0);
  const seat = free[Math.floor(Math.random() * free.length)];
  const hold = await ctx.request.post(`${BASE}/api/events/${TERM}/seats/hold`, { data: { seatIds: [seat.id] }, headers: { 'x-fingerprint': `r22-${RUN}` } });
  expect(hold.status(), 'hold').toBe(200);
  const { holdToken } = (await hold.json()) as { holdToken: string };
  note(`(b) místo ${seat.sector} ř. ${seat.row} č. ${seat.num} podrženo`);

  // pokladna s volbou dárku (URL jako ze SeatPickeru u termínu bez kategorií) → simulátor GoPay → zaplaceno
  const q = new URLSearchParams({ eventId: TERM, ticketTypeId: seat.ttId, seatHoldToken: holdToken, seatIds: seat.id, quantity: '1' });
  await page.goto(`/cs/checkout?${q.toString()}`, { waitUntil: 'networkidle' });
  await page.locator('#checkout-name').fill('Dárce Kola 22');
  await page.locator('#checkout-email').fill(buyer);
  await page.getByLabel('Kupuji jako dárek').check();
  await page.locator('#gift-email').fill(recipient);
  await page.locator('#gift-name').fill('Obdarovaný');
  const [co] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/checkout') && r.request().method() === 'POST', { timeout: 60_000 }),
    page.getByRole('button', { name: /Pokračovat na platbu/ }).click(),
  ]);
  const coBody = (await co.json()) as { giftClaimToken?: string; orderId?: string; error?: string; message?: string };
  expect(co.status(), `POST /api/checkout ${coBody.error ?? ''} ${coBody.message ?? ''}`).toBe(200);
  const token = coBody.giftClaimToken ?? '';
  expect(token.length, 'giftClaimToken z odpovědi /api/checkout').toBeGreaterThanOrEqual(10);
  note(`(b) dárková objednávka založena, token dárku ${mask(token)}`);
  await page.waitForURL(/localhost:3998\/gw\//, { timeout: 30_000 });
  await page.getByTestId('gw-pay').click();
  await page.waitForURL((u) => u.href.startsWith(BASE), { timeout: 30_000 });
  await expect.poll(async () => (await ctx.request.get(`${BASE}/api/gift/${token}`)).status(), { timeout: 30_000, message: 'dárek zaplacen (GET /api/gift 200)' }).toBe(200);

  // /cs/gift/<token> → výběr termínu → Uplatnit (skutečné POST /api/gift/<token>)
  await page.goto(`/cs/gift/${token}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: /Obdarovaný, máš dárek!/ })).toBeVisible({ timeout: 20_000 });
  const termButtons = page.locator('button', { hasText: 'zbývá' });
  if (await termButtons.count()) await termButtons.first().click();
  const [claim] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(`/api/gift/${token}`) && r.request().method() === 'POST', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Uplatnit dárkový lístek' }).click(),
  ]);
  expect(claim.status(), 'POST /api/gift/<token>').toBe(200);
  const { qrPayload } = (await claim.json()) as { qrPayload?: string };
  // pojistka proti průchodu naprázdno
  expect(qrPayload ?? '', 'qrPayload z odpovědi API').toMatch(/^otpauth:\/\/totp\/.+secret=/);
  const ticketSecret = new URL(qrPayload!.replace('otpauth://', 'http://')).searchParams.get('secret') ?? '';
  note(`(b) qrPayload ${mask(qrPayload!)} (délka ${qrPayload!.length}), secret vstupenky ${mask(ticketSecret)}`);

  const img = page.locator('img[alt="Vstupenka QR"]');
  await expect(img, 'QR vstupenky vykreslen').toBeVisible({ timeout: 20_000 });
  const st = await imgState(img);
  note(`(b2) img alt="Vstupenka QR": class="${st.cls}", width=${st.wAttr} height=${st.hAttr}, complete=${st.complete}, natural ${st.nw}×${st.nh}, box ${JSON.stringify(st.box)}`);
  await shot(page, 'b2_gift', [img]);

  // (b1)
  const b1 = summarize('(b1)', out, { qrPayload: qrPayload!, 'secret vstupenky': ticketSecret, 'token dárku': token });
  expect.soft(b1.withSecret, '(b1) požadavky mimo localhost s qrPayload/tokenem dárku').toBe(0);
  expect.soft(b1.qrserver, '(b1) požadavky na api.qrserver.com').toBe(0);

  // (b2)
  expect.soft([st.wAttr, st.hAttr], '(b2) width/height 220').toEqual(['220', '220']);
  expect.soft(st.cls, '(b2) třídy beze změny').toBe('rounded-lg border shadow-sm');
  expect.soft(st.src.startsWith('data:image/png;base64,'), '(b2) src = data:image/png;base64').toBe(true);
  const c = await compareQr('(b2)', st.src, qrPayload!, 220);
  expect.soft(c.pixelsEqual, '(b2) obrázek = QRCode.toDataURL(qrPayload, { width: 220, margin: 4 })').toBe(true);
  expect.soft([st.nw, st.nh], '(b2) vykreslený obrázek 220×220').toEqual([220, 220]);
  await ctx.close();
});
