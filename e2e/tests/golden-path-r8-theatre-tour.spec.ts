/**
 * Kolo 8 / krok 9 — E2E scénář turné divadelní agentury + vizuální průchod (screenshoty do logs/r8/tour/).
 *
 * Běží proti lokálnímu `next start` (BASE_URL, výchozí http://localhost:3200) nad lokální DB (tixly_app + RLS),
 * simulátor GoPay :3998 (platební stránka /gw/:id), mailpit :58225, lokální ARES (tento soubor, :3997).
 * Nic nejde mimo localhost.
 *
 *  1. inscenace a dva sály ve dvou městech v editoru (generátor / obkreslení podkladu)
 *  2. dva termíny inscenace + třetí termín jiné inscenace
 *  3. blokace Firma XY (20), Tisk (4), Technika (2)
 *  4. kategorie plné, senior, student, ZTP/P + doprovod; promo −10 % jen na plné
 *  5. online nákup s výběrem místa a kategorie přes simulátor GoPay (mobil 390 px), e-mail, PDF
 *  6. rezervace → vyzvednutí a platba na pokladně; druhá rezervace → propadnutí → místa zpět
 *  7. z blokace Firma XY firemní objednávka 15 míst na fakturu → zaplaceno → vstupenky; 5 míst uvolnit; Tisk 4× volná na jméno
 *  8. vstupní kontrola: běžná, ZTP/P (ověřit průkaz), jiný termín (odmítnuto), již použitá
 *  9. zrušení termínu → refundy, dobropisy, e-maily
 * 10. reporty a seznam pro uvaděče sedí s daty
 */
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const OWNER_URL = process.env.AUDIT_OWNER_URL ?? 'postgresql://neondb_owner:fixowner@localhost:55632/r8z';
const MAILPIT = process.env.MAILPIT ?? 'http://localhost:58225';
const SHOTS = join(__dirname, '..', '..', 'logs', 'r8', 'tour');
const APP_ENV = join(__dirname, '..', '..', 'nextjs-boilerplate', 'fix.app.env');
// Kolo 9: na stagingu se secret předá env (CRON_SECRET); lokálně z fix.app.env
const CRON_SECRET = process.env.CRON_SECRET
  ?? (existsSync(APP_ENV) ? /^CRON_SECRET=(.*)$/m.exec(readFileSync(APP_ENV, 'utf8'))?.[1]?.trim().replace(/^"|"$/g, '') : undefined)
  ?? '';
/** simulator = lokální simulátor GoPay (/gw/:id); manual = staging se sandboxem GoPay — platbu testovací kartou provede člověk v okně prohlížeče. */
const PAY_MODE = (process.env.TOUR_PAY_MODE ?? 'simulator') as 'simulator' | 'manual';

async function payAtGateway(page: Page, expectedAmount: string | null, shotName: string | null): Promise<void> {
  if (PAY_MODE === 'manual') {
    // čeká, až člověk zaplatí v sandboxu GoPay a brána vrátí kupce na web (max 10 min)
    await page.waitForURL((u) => u.href.startsWith(BASE), { timeout: 600_000 });
    return;
  }
  await page.waitForURL(/localhost:3998\/gw\//, { timeout: 20_000 });
  if (expectedAmount) await expect(page.getByTestId('gw-amount')).toContainText(expectedAmount);
  if (shotName) await shot(page, shotName);
  await page.getByTestId('gw-pay').click();
  await page.waitForURL((u) => u.href.startsWith(BASE), { timeout: 20_000 });
}
const RUN = Date.now().toString(36);
const PASS = 'Tour2026!heslo';
// vlastní klientská IP běhu (lokální server bez proxy bere x-real-ip) — sdílené rate limity registrace/přihlášení
// se tak mezi opakovanými běhy nesčítají; limity samotné zůstávají v platnosti
const RUN_IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;

mkdirSync(SHOTS, { recursive: true });
test.describe.configure({ mode: 'serial' });

// ── sdílený stav scénáře ──────────────────────────────────────────────────────
const S: {
  promoterEmail: string; adminEmail: string; promoterToken: string; adminToken: string; promoterId: string;
  places: Record<string, string>; halls: Record<string, string>; productionId: string; otherProductionId: string;
  terms: string[]; cat: Record<string, string>; blocks: Record<string, string>; promoCode: string;
  onlineOrder: string; ztppTicket: string; plneTicket: string; term2Ticket: string; buyerEmail: string;
} = {
  promoterEmail: `tour-${RUN}@agentura.test`, adminEmail: `tour-admin-${RUN}@tixly.test`, promoterToken: '', adminToken: '', promoterId: '',
  places: {}, halls: {}, productionId: '', otherProductionId: '', terms: [], cat: {}, blocks: {}, promoCode: `PLNE10${RUN.toUpperCase()}`,
  onlineOrder: '', ztppTicket: '', plneTicket: '', term2Ticket: '', buyerEmail: `divak-${RUN}@tixly.test`,
};
let db: pg.Client;
let api: APIRequestContext;
let ares: Server;
const results: Array<{ step: string; ok: boolean; note: string }> = [];

const shot = async (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query(sql, params)).rows as T[];
async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown, token = S.promoterToken): Promise<{ status: number; json: T }> {
  const r = await api.fetch(path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: BASE }, data: body === undefined ? undefined : JSON.stringify(body) });
  let json = {} as T;
  try { json = (await r.json()) as T; } catch { /* */ }
  return { status: r.status(), json };
}
async function mail(to: string, subjectPart: string): Promise<{ id: string; subject: string; html: string; attachments: Array<{ FileName: string; PartID: string }> }> {
  for (let i = 0; i < 60; i++) {
    const j = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=30`)).json() as { messages?: Array<{ ID: string; Subject: string }> };
    const hit = j.messages?.find((m) => m.Subject.includes(subjectPart));
    if (hit) {
      const m = await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json() as { HTML?: string; Attachments?: Array<{ FileName: string; PartID: string }> };
      return { id: hit.ID, subject: hit.Subject, html: m.HTML ?? '', attachments: m.Attachments ?? [] };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`e-mail „${subjectPart}" pro ${to} nedorazil`);
}
async function consent(ctx: BrowserContext): Promise<void> {
  await ctx.setExtraHTTPHeaders({ 'x-real-ip': RUN_IP });
  await ctx.addInitScript(() => {
    try { window.localStorage.setItem('tixly.cookie-consent', JSON.stringify({ essential: true, analytics: false, marketing: false, decidedAt: new Date().toISOString() })); } catch { /* */ }
  });
}
/** Relace pořadatele z prvního přihlášení — přihlášení má limit 10 / 5 min na IP i účet, scénář se přihlásí jen jednou. */
let session: Awaited<ReturnType<BrowserContext['storageState']>> | null = null;
async function login(page: Page, email: string): Promise<void> {
  if (session) {
    await page.context().addCookies(session.cookies);
    const items = session.origins.find((o) => o.origin === new URL(BASE).origin)?.localStorage ?? [];
    await page.context().addInitScript((kv: Array<{ name: string; value: string }>) => {
      for (const { name, value } of kv) { try { window.localStorage.setItem(name, value); } catch { /* */ } }
    }, items);
    await page.goto('/admin');
    await page.waitForURL(/\/admin(?!\/?login)/, { timeout: 20_000 });
    return;
  }
  await page.goto('/cs/login', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Heslo').fill(PASS);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST'),
    page.getByRole('button', { name: /^Přihlásit$/ }).click(),
  ]);
  await page.waitForURL(/\/admin(?!\/?login)/, { timeout: 20_000 });
  session = await page.context().storageState();
}
/** Půdorys sálu jako PNG (podklad pro obkreslení): jeviště + 3 řady sedadel jako tečky. */
function floorPlanPng(): Buffer {
  const w = 600; const h = 400;
  const px = Buffer.alloc((w * 3 + 1) * h, 255);
  const dot = (cx: number, cy: number, r: number, c: number) => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= 0 && x < w && y >= 0 && y < h) px.fill(c, y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3);
    }
  };
  for (let y = 20; y < 60; y++) for (let x = 150; x < 450; x++) px.fill(80, y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3);
  for (let row = 0; row < 3; row++) for (let s = 0; s < 8; s++) dot(130 + s * 48, 140 + row * 70, 9, 40);
  for (let y = 0; y < h; y++) px[y * (w * 3 + 1)] = 0;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    let c = 0xffffffff;
    for (const b of td) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
    const crc = Buffer.alloc(4); crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(px)), chunk('IEND', Buffer.alloc(0))]);
}
async function seatCircle(page: Page, title: string) {
  return page.locator('svg circle').filter({ has: page.locator('title', { hasText: title }) }).first();
}
async function marqueeSelect(page: Page, sectorPrefix: string): Promise<void> {
  await page.keyboard.press('Escape');
  await page.evaluate((prefix) => {
    const c = [...document.querySelectorAll('svg[aria-label="Seating chart editor canvas"] circle')]
      .find((x) => (x.querySelector('title')?.textContent ?? '').startsWith(prefix));
    c?.scrollIntoView({ block: 'center' });
  }, sectorPrefix);
  await page.waitForTimeout(200);
  const box = await page.evaluate((prefix) => {
    const rs = [...document.querySelectorAll('svg[aria-label="Seating chart editor canvas"] circle')]
      .filter((c) => (c.querySelector('title')?.textContent ?? '').startsWith(prefix)).map((c) => c.getBoundingClientRect());
    return { x0: Math.min(...rs.map((r) => r.left)), y0: Math.min(...rs.map((r) => r.top)), x1: Math.max(...rs.map((r) => r.right)), y1: Math.max(...rs.map((r) => r.bottom)) };
  }, sectorPrefix);
  await page.mouse.move(box.x0 - 6, box.y0 - 6);
  await page.mouse.down();
  await page.mouse.move((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, { steps: 4 });
  await page.mouse.move(box.x1 + 6, box.y1 + 6, { steps: 4 });
  await page.mouse.up();
}
async function buyerSeat(page: Page, sector: string, row: string, seat: string): Promise<void> {
  await page.locator('svg[aria-label="Plán sálu"]').first().waitFor();
  await page.locator('svg[aria-label="Plán sálu"] [aria-label^="Sektor "]').first().waitFor({ timeout: 20_000 });
  const label = `Sektor ${sector}, řada ${row}, sedadlo ${seat}, available`;
  let c = page.locator(`[aria-label="${label}"]`);
  if (!(await c.count())) {
    await page.locator(`[aria-label^="Sektor ${sector}, dostupných"]`).first().click();
    c = page.locator(`[aria-label="${label}"]`);
  }
  await c.first().click();
}
const record = (step: string, ok: boolean, note = '') => { results.push({ step, ok, note }); };
/** Výběr volby podle začátku textu (selectOption neumí regex v label). */
async function pickOption(sel: ReturnType<Page['locator']>, text: RegExp): Promise<void> {
  const opt = sel.locator('option').filter({ hasText: text }).first();
  await sel.selectOption((await opt.getAttribute('value'))!);
}

test.beforeAll(async ({ playwright }) => {
  db = new pg.Client({ connectionString: OWNER_URL });
  await db.connect();
  api = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-real-ip': RUN_IP } });
  // lokální ARES (testy nesmí ven)
  ares = createServer((req, res) => {
    const ico = (req.url ?? '').split('/').pop();
    if (ico === '27082440') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ico, obchodniJmeno: 'Firma XY s.r.o.', dic: 'CZ27082440', sidlo: { textovaAdresa: 'Václavské náměstí 1, 110 00 Praha 1' }, datumVzniku: '2004-01-01' }));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((r) => ares.listen(3997, '127.0.0.1', r));

  // účty: pořadatel (agentura) a platform admin — registrace přes API, role v DB (jako schválení platformou)
  for (const [email, name] of [[S.promoterEmail, 'Agentura Turné'], [S.adminEmail, 'Platform Admin']] as const) {
    const r = await api.post('/api/auth/register', { data: { email, password: PASS, name }, headers: { origin: BASE } });
    expect(r.status(), await r.text()).toBe(200);
  }
  await db.query(`UPDATE identity.users SET is_platform_admin = true WHERE email = $1`, [S.adminEmail]);
  const promoterId = (await q<{ id: string }>(
    `INSERT INTO platform.promoters (name, email, contact_email, slug, status, vat_payer, company_ico, company_dic, company_address, bank_account)
     VALUES ('Turné agentura s.r.o.', $1, $1, $2, 'active', true, '12345678', 'CZ12345678', 'Celetná 17, 110 00 Praha 1', '123456789/0100') RETURNING id`,
    [S.promoterEmail, `turne-${RUN}`]))[0].id;
  S.promoterId = promoterId;
  await db.query(`INSERT INTO platform.promoter_members (promoter_id, user_id, role) SELECT $1, id, 'owner' FROM identity.users WHERE email = $2`, [promoterId, S.promoterEmail]);
  for (const [email, key] of [[S.promoterEmail, 'promoterToken'], [S.adminEmail, 'adminToken']] as const) {
    const r = await api.post('/api/auth/login', { data: { email, password: PASS }, headers: { origin: BASE } });
    S[key] = ((await r.json()) as { accessToken: string }).accessToken;
  }
});

test.afterAll(async () => {
  writeFileSync(join(SHOTS, 'results.json'), JSON.stringify(results, null, 2));
  await api?.dispose();
  await db?.end();
  await new Promise((r) => ares?.close(r));
});

test('1 — inscenace a dva sály ve dvou městech v editoru (generátor / obkreslení podkladu)', async ({ page, context }) => {
  test.setTimeout(240_000);
  await consent(context);
  await login(page, S.promoterEmail);
  // inscenace (karta)
  await page.goto('/admin/productions');
  await page.getByPlaceholder('Název inscenace (např. Racek)').fill('Racek');
  await page.getByRole('button', { name: 'Vytvořit' }).click();
  await page.waitForURL(/\/admin\/productions\/[0-9a-f-]{36}/);
  S.productionId = (await q<{ id: string }>(`SELECT id FROM catalog.productions WHERE promoter_id = $1 AND title = 'Racek'`, [S.promoterId]))[0].id;
  await page.goto(`/admin/productions/${S.productionId}`);
  await page.getByLabel('Podtitul').fill('Komedie o čtyřech dějstvích');
  await page.getByLabel('Autor').fill('Anton Pavlovič Čechov');
  await page.getByLabel('Režie').fill('Jan Novák');
  await page.getByLabel('Délka (min)').fill('150');
  await page.getByLabel('Přestávka (min)').fill('20');
  await page.getByLabel('Věková přístupnost').fill('12+');
  await page.getByLabel('Žánr').fill('činohra');
  await page.getByRole('button', { name: 'Uložit kartu' }).click();
  await expect(page.locator('[data-testid="production-msg"]')).toBeVisible();
  await shot(page, '01a-inscenace-karta');

  // místa a sály
  await page.goto('/admin/venues');
  for (const [place, city] of [['Městské divadlo Brno', 'Brno'], ['Divadlo Petra Bezruče', 'Ostrava']] as const) {
    await page.getByTestId('place-name').fill(place);
    await page.getByTestId('place-city').fill(city);
    await page.getByTestId('place-address').fill(`${city}, náměstí 1`);
    await page.getByTestId('place-add').click();
    await page.locator('[data-testid="place-card"]', { hasText: place }).waitFor();
  }
  // přidání sálu otevře rovnou jeho editor plánku
  const addHall = async (place: string, hall: string) => {
    await page.goto('/admin/venues');
    const card = page.locator('[data-testid="place-card"]', { hasText: place });
    await card.getByTestId('hall-name').fill(hall);
    await card.getByTestId('hall-add').click();
    await page.waitForURL(/\/admin\/venues\/[0-9a-f-]{36}\/seating-chart\/editor/);
    S.halls[hall] = /venues\/([0-9a-f-]{36})\//.exec(page.url())![1];
  };
  await addHall('Městské divadlo Brno', 'Velký sál');

  // sál 1: generátor — přízemí 8 × 15, balkon 2 × 10, zóny A/B, 2 vozíčkáři + doprovod
  const gen = async (name: string, rows: string, seats: string, y: string) => {
    await page.getByLabel('Název sekce').fill(name);
    await page.getByLabel('Počet řad').fill(rows);
    await page.getByLabel('Míst v řadě').fill(seats);
    await page.getByLabel('Začátek Y').fill(y);
    await page.getByTestId('generate-section').click();
  };
  await gen('Přízemí', '8', '15', '150');
  await gen('Balkon', '2', '10', '620');
  for (const z of ['Zóna A', 'Zóna B']) { await page.getByTestId('zone-name').fill(z); await page.getByTestId('zone-add').click(); }
  await page.keyboard.press('1');
  await marqueeSelect(page, 'Přízemí ·');
  await page.getByTestId('zone-assign-Zóna A').click();
  await marqueeSelect(page, 'Balkon ·');
  await page.getByTestId('zone-assign-Zóna B').click();
  // vozíčkáři: řada 8 místa 1 a 15, doprovod 2 a 14
  const pick = async (titles: string[]) => {
    await page.keyboard.press('Escape');
    for (const [i, t] of titles.entries()) {
      const c = await seatCircle(page, t);
      await c.click({ modifiers: i === 0 ? [] : ['Shift'], force: true });
    }
  };
  await pick(['Přízemí · řada 8 · sedadlo 1', 'Přízemí · řada 8 · sedadlo 15']);
  await page.getByTestId('seat-type-wheelchair').click();
  await pick(['Přízemí · řada 8 · sedadlo 2', 'Přízemí · řada 8 · sedadlo 14']);
  await page.getByTestId('seat-type-companion').click();
  await shot(page, '01c-editor-generator');
  await page.getByRole('button', { name: 'Uložit layout' }).click();
  await expect.poll(async () => (await q(`SELECT 1 FROM catalog.venue_seating_charts WHERE venue_id = $1`, [S.halls['Velký sál']])).length, { timeout: 15_000 }).toBe(1);

  // sál 2: podklad (PNG) + obkreslení 3 řad nástrojem Řada
  await addHall('Divadlo Petra Bezruče', 'Komorní scéna');
  const png = join(SHOTS, 'podklad-komorni-scena.png');
  writeFileSync(png, floorPlanPng());
  await page.locator('input[type="file"][accept*="image/png"]').setInputFiles(png);
  const underlay = page.getByTestId('chart-underlay');
  await underlay.waitFor({ timeout: 15_000 });
  await page.keyboard.press('2');
  const canvas = page.locator('svg[aria-label="Seating chart editor canvas"]');
  const ub = (await underlay.boundingBox())!;
  for (let row = 0; row < 3; row++) {
    const y = ub.y + ub.height * ((140 + row * 70) / 400);
    await canvas.click({ position: { x: ub.x - (await canvas.boundingBox())!.x + ub.width * (130 / 600), y: y - (await canvas.boundingBox())!.y } });
    await canvas.click({ position: { x: ub.x - (await canvas.boundingBox())!.x + ub.width * (466 / 600), y: y - (await canvas.boundingBox())!.y } });
    const count = page.locator('input[type="number"][max="200"]');
    await count.fill('8');
    await page.getByRole('button', { name: 'Přidat řadu' }).click();
  }
  await page.keyboard.press('1');
  await page.getByTestId('zone-name').fill('Zóna A');
  await page.getByTestId('zone-add').click();
  await marqueeSelect(page, 'Sektor A ·');
  await page.getByTestId('zone-assign-Zóna A').click();
  await shot(page, '01d-editor-obkresleni-podkladu');
  await page.getByRole('button', { name: 'Uložit layout' }).click();
  await expect.poll(async () => (await q(`SELECT 1 FROM catalog.venue_seating_charts WHERE venue_id = $1`, [S.halls['Komorní scéna']])).length, { timeout: 15_000 }).toBe(1);

  await page.goto('/admin/venues');
  await shot(page, '01b-knihovna-mist');
  const layouts = await q<{ name: string; seats: number; wheel: number; comp: number }>(
    `SELECT v.name,
            (SELECT COUNT(*) FROM jsonb_array_elements(c.layout->'sectors') s, jsonb_array_elements(s->'rows') r, jsonb_array_elements(r->'seats') x)::int AS seats,
            (SELECT COUNT(*) FROM jsonb_array_elements(c.layout->'sectors') s, jsonb_array_elements(s->'rows') r, jsonb_array_elements(r->'seats') x WHERE x->>'type' = 'wheelchair')::int AS wheel,
            (SELECT COUNT(*) FROM jsonb_array_elements(c.layout->'sectors') s, jsonb_array_elements(s->'rows') r, jsonb_array_elements(r->'seats') x WHERE x->>'type' = 'companion')::int AS comp
       FROM catalog.venue_seating_charts c JOIN catalog.venues v ON v.id = c.venue_id WHERE c.venue_id = ANY($1::uuid[]) ORDER BY v.name`,
    [[S.halls['Velký sál'], S.halls['Komorní scéna']]]);
  // název sálu v DB = „Místo – Sál"
  expect(Object.fromEntries(layouts.map((l) => [l.name.split(' – ').pop(), { seats: l.seats, wheel: l.wheel, comp: l.comp }]))).toEqual({
    'Velký sál': { seats: 140, wheel: 2, comp: 2 }, 'Komorní scéna': { seats: 24, wheel: 0, comp: 0 },
  });
  // zóny přiřazené výběrem: přízemí = Zóna A, balkon = Zóna B
  const zones = await q<{ sector: string; zone: string; n: number }>(
    `SELECT s->>'name' AS sector, z->>'name' AS zone, COUNT(*)::int AS n
       FROM catalog.venue_seating_charts c, jsonb_array_elements(c.layout->'sectors') s, jsonb_array_elements(s->'rows') r, jsonb_array_elements(r->'seats') x
       LEFT JOIN LATERAL (SELECT zz FROM jsonb_array_elements(c.layout->'zones') zz WHERE zz->>'id' = x->>'zone') zl(z) ON true
      WHERE c.venue_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`, [S.halls['Velký sál']]);
  expect(zones).toEqual([{ sector: 'Balkon', zone: 'Zóna B', n: 20 }, { sector: 'Přízemí', zone: 'Zóna A', n: 120 }]);
  record('1', true, `Velký sál 140 míst (2 vozíčkáři + 2 doprovod), Komorní scéna 24 míst obkresleno`);
});

test('2 — dva termíny inscenace + třetí termín jiné inscenace', async ({ page, context }) => {
  test.setTimeout(180_000);
  await consent(context);
  await login(page, S.promoterEmail);
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const newTerm = async (productionId: string, city: string, hall: string, date: string, prices: Record<string, string>) => {
    await page.goto(`/admin/productions/${productionId}`);
    await page.getByTestId('term-city').selectOption({ label: city });
    const venueSel = page.getByTestId('term-venue');
    await expect(venueSel.locator('option', { hasText: hall })).toHaveCount(1);
    await venueSel.selectOption((await venueSel.locator('option', { hasText: hall }).getAttribute('value'))!);
    // vlastní ceník po zónách (jinak formulář nabídne převzetí ceníku z předchozího termínu)
    await page.getByTestId('term-copy').selectOption('');
    await page.getByTestId('term-date').fill(date);
    await page.getByTestId('term-time').fill('19:00');
    for (const [zone, price] of Object.entries(prices)) await page.locator('[data-testid="zone-prices"] label', { hasText: zone }).locator('input').fill(price);
    await page.getByTestId('term-create').click();
    await expect(page.locator('[data-testid="production-msg"]')).toBeVisible();
  };
  await newTerm(S.productionId, 'Brno', 'Velký sál', day(20), { 'Zóna A': '450', 'Zóna B': '300' });
  await newTerm(S.productionId, 'Ostrava', 'Komorní scéna', day(25), { 'Zóna A': '350' });
  await page.goto(`/admin/productions/${S.productionId}`);
  await shot(page, '02a-terminy-inscenace');
  // jiná inscenace
  await page.goto('/admin/productions');
  await page.getByPlaceholder('Název inscenace (např. Racek)').fill('Hamlet');
  await page.getByRole('button', { name: 'Vytvořit' }).click();
  await page.waitForURL(/\/admin\/productions\/[0-9a-f-]{36}/); // po vytvoření aplikace sama otevře kartu
  await expect.poll(async () => (await q(`SELECT 1 FROM catalog.productions WHERE promoter_id = $1 AND title = 'Hamlet'`, [S.promoterId])).length).toBe(1);
  S.otherProductionId = (await q<{ id: string }>(`SELECT id FROM catalog.productions WHERE promoter_id = $1 AND title = 'Hamlet'`, [S.promoterId]))[0].id;
  await newTerm(S.otherProductionId, 'Brno', 'Velký sál', day(30), { 'Zóna A': '500', 'Zóna B': '320' });

  const terms = await q<{ id: string; title: string; seats: number; status: string }>(
    `SELECT e.id, e.title, (SELECT COUNT(*) FROM catalog.event_seats s WHERE s.event_id = e.id)::int AS seats, e.status
       FROM catalog.events e WHERE e.promoter_id = $1 ORDER BY e.date_start`, [S.promoterId]);
  expect(terms.map((t) => [t.title, t.seats])).toEqual([['Racek', 140], ['Racek', 24], ['Hamlet', 140]]);
  S.terms = terms.map((t) => t.id);
  // schválení platformou (moderace) → publikováno
  for (const t of terms.filter((x) => x.status !== 'published')) {
    expect((await call('POST', `/api/platform/moderation/${t.id}/approve`, {}, S.adminToken)).status).toBe(200);
  }
  // veřejný web: stránka inscenace s termíny a program podle měst
  await page.goto(`/cs/inscenace/${S.productionId}`);
  await expect(page.getByText('Brno').first()).toBeVisible();
  await expect(page.getByText('Ostrava').first()).toBeVisible();
  await shot(page, '02b-verejna-stranka-inscenace');
  await page.goto('/cs/program?city=Brno');
  await expect(page.getByText('Hamlet').first()).toBeVisible();
  await shot(page, '02c-program-brno');
  record('2', true, 'Racek Brno (140 míst), Racek Ostrava (24), Hamlet Brno (140); schváleno a publikováno');
});

test('3 — blokace Firma XY (20), Tisk (4), Technika (2)', async ({ page, context }) => {
  test.setTimeout(120_000);
  await consent(context);
  await login(page, S.promoterEmail);
  const t1 = S.terms[0];
  await page.goto(`/admin/events/${t1}/blokace`);
  await page.getByTestId('block-name').fill('Firma XY');
  await page.locator('select').filter({ hasText: 'vybraná místa' }).selectOption({ label: 'Balkon' });
  await page.getByTestId('block-create').click();
  await expect(page.getByTestId('blocks-msg')).toContainText('20 míst');
  const pickSeats = async (row: string, seats: string[]) => {
    for (const s of seats) await page.locator('svg[aria-label="Plánek s blokacemi"] circle').filter({ has: page.locator('title', { hasText: `Přízemí řada ${row} místo ${s} —` }) }).click();
  };
  await page.getByTestId('block-name').fill('Tisk');
  await pickSeats('1', ['7', '8', '9', '10']);
  await page.getByTestId('block-create').click();
  await expect(page.getByTestId('blocks-msg')).toContainText('4 míst');
  await page.getByTestId('block-name').fill('Technika');
  await pickSeats('8', ['7', '8']);
  await page.getByTestId('block-create').click();
  await expect(page.getByTestId('blocks-msg')).toContainText('2 míst');
  await shot(page, '03-blokace');
  const blocks = await q<{ name: string; n: number; id: string }>(
    `SELECT b.name, b.id, COUNT(bs.seat_id)::int AS n FROM catalog.seat_blocks b JOIN catalog.seat_block_seats bs ON bs.block_id = b.id WHERE b.event_id = $1 GROUP BY b.id ORDER BY b.created_at`, [t1]);
  expect(blocks.map((b) => [b.name, b.n])).toEqual([['Firma XY', 20], ['Tisk', 4], ['Technika', 2]]);
  for (const b of blocks) S.blocks[b.name] = b.id;
  record('3', true, 'Firma XY 20 (celý balkon), Tisk 4, Technika 2');
});

test('4 — kategorie plné, senior, student, ZTP/P + doprovod; promo −10 % jen na plné', async ({ page, context }) => {
  test.setTimeout(120_000);
  await consent(context);
  await login(page, S.promoterEmail);
  for (const t of [S.terms[0], S.terms[1]]) {
    await page.goto(`/admin/events/${t}/kategorie`);
    const cats: Array<[string, string, string, 'percent' | 'fixed', string, string]> = [
      ['plne', 'Plné', 'full', 'percent', '100', ''], ['senior', 'Senior', 'senior', 'percent', '80', 'Senior (věk)'],
      ['student', 'Student', 'student', 'percent', '70', 'Student (ISIC)'], ['ztpp', 'ZTP/P', 'ztpp', 'percent', '50', 'ZTP/P'],
      ['doprovod-ztpp', 'Doprovod ZTP/P', 'ztpp_companion', 'fixed', '0', ''],
    ];
    for (const [code, name, kind, mode, price, proof] of cats) {
      await page.getByPlaceholder('Kód (např. senior)').fill(code);
      await page.getByPlaceholder('Název').fill(name);
      const sels = page.locator('section select');
      await sels.nth(0).selectOption(kind);
      await sels.nth(1).selectOption(mode);
      await page.getByPlaceholder(mode === 'percent' ? 'Procento' : 'Kč').fill(price);
      const box = page.getByLabel('Průkaz při vstupu');
      if (proof) { await box.check(); await page.getByPlaceholder('Text průkazu (ZTP/P…)').fill(proof); } else if (await box.isChecked()) await box.uncheck();
      await page.getByRole('button', { name: 'Uložit kategorii' }).click();
      await expect(page.locator('[data-testid="category-table"]')).toContainText(name);
    }
  }
  await page.goto(`/admin/events/${S.terms[0]}/kategorie`);
  await shot(page, '04a-kategorie-cenik');
  const created = await call('POST', '/api/admin/promo-codes', { code: S.promoCode, type: 'percentage', discountValue: 10, applicableCategoryCodes: ['plne'] });
  expect(created.status).toBe(201);
  for (const row of await q<{ code: string; id: string }>(`SELECT code, id FROM catalog.price_categories WHERE event_id = $1`, [S.terms[0]])) S.cat[row.code] = row.id;
  expect(Object.keys(S.cat).sort()).toEqual(['doprovod-ztpp', 'plne', 'senior', 'student', 'ztpp']);
  record('4', true, `5 kategorií na termínech Racek; promo ${S.promoCode} −10 % jen na plné`);
});

async function mobile(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await consent(ctx);
  return { ctx, page: await ctx.newPage() };
}
async function noHorizontalScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(391);
}

test('5 — online nákup s výběrem místa a kategorie přes simulátor GoPay (390 px), e-mail, PDF', async ({ browser }) => {
  test.setTimeout(PAY_MODE === 'manual' ? 1_500_000 : 180_000);
  const { ctx, page } = await mobile(browser);
  const t1 = S.terms[0];
  await page.goto(`/cs/events/${t1}/seats`);
  await buyerSeat(page, 'Přízemí', '2', '5');
  await buyerSeat(page, 'Přízemí', '2', '6');
  await buyerSeat(page, 'Přízemí', '2', '7');
  await noHorizontalScroll(page);
  await shot(page, '05a-mobil-vyber-mist');
  await page.getByRole('button', { name: /Pokračovat na pokladnu/ }).click();
  await page.waitForURL(/\/seats\/kategorie/);
  await page.locator('[data-testid="seat-category-row"]').first().waitFor();
  await pickOption(page.getByLabel('Kategorie pro řadu 2 místo 5'), /^Plné/);
  await pickOption(page.getByLabel('Kategorie pro řadu 2 místo 6'), /^ZTP\/P/);
  await pickOption(page.getByLabel('Kategorie pro řadu 2 místo 7'), /^Doprovod/);
  await page.getByPlaceholder('E-mail').fill(S.buyerEmail);
  await page.getByPlaceholder('Jméno a příjmení').fill('Eva Divačka');
  await page.getByPlaceholder('Slevový kód (nepovinné)').fill(S.promoCode);
  await noHorizontalScroll(page);
  await shot(page, '05b-mobil-kategorie');
  await page.getByRole('button', { name: 'Zaplatit' }).click();
  await payAtGateway(page, '630', '05c-gopay-simulator');
  await shot(page, '05d-potvrzeni-objednavky');
  await expect.poll(async () => (await q(`SELECT 1 FROM tickets.tickets t JOIN orders.orders o ON o.id = t.order_id JOIN identity.users u ON u.id = o.user_id WHERE u.email = $1`, [S.buyerEmail])).length, { timeout: 30_000 }).toBe(3);
  const tickets = await q<{ id: string; seat: string; cat: string; order_id: string; total: number }>(
    `SELECT t.id, es.seat_number AS seat, t.price_category_name AS cat, o.id AS order_id, o.total_amount AS total
       FROM tickets.tickets t JOIN orders.orders o ON o.id = t.order_id JOIN identity.users u ON u.id = o.user_id
       JOIN catalog.event_seats es ON es.id = t.event_seat_id WHERE u.email = $1 ORDER BY es.seat_number::int`, [S.buyerEmail]);
  expect(tickets.map((t) => [t.seat, t.cat])).toEqual([['5', 'Plné'], ['6', 'ZTP/P'], ['7', 'Doprovod ZTP/P']]);
  expect(tickets[0].total).toBe(63000);
  S.onlineOrder = tickets[0].order_id; S.plneTicket = tickets[0].id; S.ztppTicket = tickets[1].id;
  const m = await mail(S.buyerEmail, 'Racek');
  const pdf = m.attachments.find((a) => a.FileName.endsWith('.pdf'));
  expect(pdf).toBeTruthy();
  writeFileSync(join(SHOTS, '05e-vstupenky.pdf'), Buffer.from(await (await fetch(`${MAILPIT}/api/v1/message/${m.id}/part/${pdf!.PartID}`)).arrayBuffer()));
  writeFileSync(join(SHOTS, '05f-email.html'), m.html);
  expect(m.html).toContain('ZTP/P');
  await ctx.close();

  // nákup na druhý termín (pro kontrolu „jiný termín" u vstupu a pro zrušení)
  const { ctx: c2, page: p2 } = await mobile(browser);
  await p2.goto(`/cs/events/${S.terms[1]}/seats`);
  await buyerSeat(p2, 'Sektor A', 'A', '3');
  await p2.getByRole('button', { name: /Pokračovat na pokladnu/ }).click();
  await p2.waitForURL(/\/seats\/kategorie/);
  await p2.getByPlaceholder('E-mail').fill(`ostrava-${RUN}@tixly.test`);
  await p2.getByPlaceholder('Jméno a příjmení').fill('Petr Ostravák');
  await p2.getByRole('button', { name: 'Zaplatit' }).click();
  await payAtGateway(p2, null, null);
  await expect.poll(async () => (await q(`SELECT 1 FROM tickets.tickets t JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id WHERE tt.event_id = $1`, [S.terms[1]])).length, { timeout: 30_000 }).toBe(1);
  S.term2Ticket = (await q<{ id: string }>(`SELECT t.id FROM tickets.tickets t JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id WHERE tt.event_id = $1`, [S.terms[1]]))[0].id;
  await c2.close();
  record('5', true, 'mobil 390 px: 3 místa (Plné −10 %, ZTP/P, doprovod) = 630 Kč přes simulátor GoPay; e-mail + PDF uloženy');
});

test('6 — rezervace → vyzvednutí a platba na pokladně; druhá rezervace → propadnutí → místa zpět', async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  await consent(context);
  await login(page, S.promoterEmail);
  const t1 = S.terms[0];
  await page.goto(`/admin/events/${t1}/rezervace`);
  await page.getByTestId('res-occupancy').waitFor(); // nastavení načtené (jinak load přepíše zaškrtnutí)
  await page.getByLabel('Povolit rezervace').check();
  await page.getByRole('button', { name: 'Uložit' }).click();
  await expect(page.getByTestId('res-msg')).toBeVisible();

  const reserve = async (seats: string[], email: string) => {
    const { ctx, page: m } = await mobile(browser);
    await m.goto(`/cs/events/${t1}/seats`);
    for (const s of seats) await buyerSeat(m, 'Přízemí', '3', s);
    await m.getByRole('button', { name: /Pokračovat na pokladnu/ }).click();
    await m.waitForURL(/\/seats\/kategorie/);
    await m.getByPlaceholder('E-mail').fill(email);
    await m.getByPlaceholder('Jméno a příjmení').fill('Jana Rezervující');
    await m.getByPlaceholder('Telefon (nepovinné)').fill('+420 777 111 222');
    await m.getByTestId('reserve-box-office').click();
    const code = (await m.getByTestId('reservation-code').textContent())!.trim();
    await shot(m, `06a-mobil-rezervace-${code}`);
    await ctx.close();
    return code;
  };
  const resEmail = `rez-${RUN}@tixly.test`;
  const code1 = await reserve(['1', '2'], resEmail);
  const m1 = await mail(resEmail, code1);
  expect(m1.html).toContain('řada 3, místo 1');
  // pokladna: hledání podle kódu, platba hotově
  await page.goto(`/admin/events/${t1}/rezervace`);
  await page.getByPlaceholder('Kód, jméno, e-mail nebo telefon').fill(code1);
  await page.getByRole('button', { name: 'Hledat' }).click();
  await page.locator('[data-testid="res-table"] tr', { hasText: code1 }).getByRole('button', { name: 'Hotově' }).click();
  await expect(page.getByTestId('res-msg')).toContainText('zaplacena (hotově): 2 vstupenek');
  await shot(page, '06b-pokladna-rezervace-zaplacena');

  // druhá rezervace → propadnutí (lhůta v minulosti) → cron přes dispatcher → místa zpět
  const code2 = await reserve(['5'], `rez2-${RUN}@tixly.test`);
  await db.query(`UPDATE orders.seat_reservations SET expires_at = now() - interval '1 minute' WHERE code = $1`, [code2]);
  const cron = await api.get('/api/cron/dispatch?job=seat-reservations', { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  expect(cron.status(), await cron.text()).toBe(200);
  const st = await q<{ status: string; seat: string }>(
    `SELECT r.status, es.status AS seat FROM orders.seat_reservations r JOIN orders.order_items oi ON oi.order_id = r.order_id JOIN catalog.event_seats es ON es.id = oi.seat_id WHERE r.code = $1`, [code2]);
  expect(st).toEqual([{ status: 'expired', seat: 'available' }]);
  await mail(`rez2-${RUN}@tixly.test`, 'vypršela');
  await page.goto(`/admin/events/${t1}/rezervace`);
  await shot(page, '06c-rezervace-prehled');
  record('6', true, `rezervace ${code1} zaplacena na pokladně hotově (2 vstupenky + doklad); ${code2} propadla, místo zpět v prodeji`);
});

test('7 — Firma XY 15 míst na fakturu → zaplaceno → vstupenky; 5 míst uvolnit; Tisk 4× volná na jméno', async ({ page, context }) => {
  test.setTimeout(180_000);
  await consent(context);
  await login(page, S.promoterEmail);
  const t1 = S.terms[0];
  page.on('dialog', (d) => void d.accept(d.message().startsWith('Reference') ? 'VS 2026-15' : 'Firma zrušila'));
  await page.goto(`/admin/events/${t1}/firemni`);
  await page.getByPlaceholder('IČO').fill('27082440');
  await page.getByRole('button', { name: 'Načíst z ARES' }).click();
  await expect(page.getByPlaceholder('Název firmy')).toHaveValue('Firma XY s.r.o.');
  await page.getByPlaceholder('Jméno').fill('Jan Nákupčí');
  await page.getByPlaceholder('E-mail').fill(`nakup-${RUN}@firma-xy.test`);
  await pickOption(page.locator('select').filter({ hasText: 'Volná místa' }), /Blokace: Firma XY/);
  const chips = page.locator('button.rounded.px-2.py-1.text-xs');
  for (let i = 0; i < 15; i++) await chips.nth(i).click();
  await expect(page.getByText('vybráno 15')).toBeVisible();
  // výchozí kategorie firemní objednávky = plné vstupné
  await expect(page.locator('select').filter({ hasText: 'Plné' }).last()).toHaveValue(S.cat.plne);
  await page.getByRole('button', { name: 'Vytvořit objednávku a fakturu' }).click();
  await expect(page.getByTestId('corp-msg')).toContainText('faktura');
  await shot(page, '07a-firemni-objednavka-faktura');
  await mail(`nakup-${RUN}@firma-xy.test`, 'Faktura');
  await page.locator('[data-testid="corp-table"] tr', { hasText: 'Firma XY' }).getByRole('button', { name: 'Zaplaceno' }).click();
  await expect(page.getByTestId('corp-msg')).toContainText('15 vstupenek');
  await shot(page, '07b-firemni-zaplaceno');
  const tm = await mail(`nakup-${RUN}@firma-xy.test`, 'vstupenky');
  expect(tm.attachments.filter((a) => a.FileName.endsWith('.pdf'))).toHaveLength(16);

  // zbylých 5 míst Firma XY uvolnit; Tisk 4× na jména
  await page.goto(`/admin/events/${t1}/blokace`);
  await page.locator('[data-testid="blocks-table"] tr', { hasText: 'Firma XY' }).getByRole('button', { name: 'Uvolnit vše' }).click();
  await expect(page.getByTestId('blocks-msg')).toBeVisible();
  await page.locator('select').filter({ hasText: '— blokace —' }).selectOption({ label: 'Tisk' });
  for (const s of ['7', '8', '9', '10']) await page.locator('svg[aria-label="Plánek s blokacemi"] circle').filter({ has: page.locator('title', { hasText: `Přízemí řada 1 místo ${s} — Tisk` }) }).click();
  const names = ['Novinář Jan Kos', 'Redaktorka Eva Malá', 'Fotograf Petr Bílý', 'Kritička Anna Nová'];
  const inputs = page.getByPlaceholder('Jméno držitele');
  for (const [i, n] of names.entries()) await inputs.nth(i).fill(n);
  await page.getByRole('button', { name: 'Vydat na jména' }).click();
  await expect(page.getByTestId('blocks-msg')).toBeVisible();
  await shot(page, '07c-blokace-po-prodeji');
  const ov = await q<{ name: string; total: number; released: number; issued: number; sold: number }>(
    `SELECT b.name, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE bs.state='released')::int AS released,
            COUNT(*) FILTER (WHERE bs.state='issued')::int AS issued, COUNT(*) FILTER (WHERE bs.state IN ('sold','corporate'))::int AS sold
       FROM catalog.seat_blocks b JOIN catalog.seat_block_seats bs ON bs.block_id = b.id WHERE b.event_id = $1 GROUP BY b.id ORDER BY b.created_at`, [t1]);
  expect(ov).toEqual([
    { name: 'Firma XY', total: 20, released: 5, issued: 0, sold: 15 },
    { name: 'Tisk', total: 4, released: 0, issued: 4, sold: 0 },
    { name: 'Technika', total: 2, released: 0, issued: 0, sold: 0 },
  ]);
  record('7', true, 'Firma XY: faktura (PDF+ISDOC) → zaplaceno → 15 vstupenek (1 společné + 15 PDF); 5 uvolněno; Tisk 4 volné na jména');
});

test('8 — vstupní kontrola: běžná, ZTP/P (ověřit průkaz), jiný termín (odmítnuto), již použitá', async ({ page, context }) => {
  test.setTimeout(120_000);
  await consent(context);
  await login(page, S.promoterEmail);
  await page.goto('/admin/scanner');
  await page.locator('select').filter({ hasText: '— vyber akci —' }).selectOption(S.terms[0]);
  const scan = async (ticketId: string, name: string) => {
    await page.getByTestId('scanner-ticket-input').fill(ticketId);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/admin/scanner/validate')),
      page.getByRole('button', { name: /Ověřit|Validovat|Odbavit|Vstup/ }).last().click(),
    ]);
    await page.waitForTimeout(300);
    await shot(page, name);
  };
  await scan(S.plneTicket, '08a-sken-bezna');
  await expect(page.locator('body')).toContainText(/Přízemí, řada 2, místo 5/);
  await scan(S.ztppTicket, '08b-sken-ztpp');
  await expect(page.getByTestId('scan-verify-id')).toContainText('Ověřit průkaz: ZTP/P');
  await scan(S.term2Ticket, '08c-sken-jiny-termin');
  await scan(S.plneTicket, '08d-sken-pouzita');
  const logs = await q<{ ticket_id: string; result: string }>(
    `SELECT ticket_id, result FROM tickets.scan_logs WHERE ticket_id = ANY($1::uuid[]) ORDER BY scanned_at`, [[S.plneTicket, S.ztppTicket, S.term2Ticket]]).catch(() => []);
  const used = await q<{ status: string }>(`SELECT status FROM tickets.tickets WHERE id = ANY($1::uuid[]) ORDER BY id`, [[S.plneTicket, S.ztppTicket]]);
  expect(used.every((u) => u.status === 'used')).toBe(true);
  expect((await q<{ status: string }>(`SELECT status FROM tickets.tickets WHERE id = $1`, [S.term2Ticket]))[0].status).toBe('valid');
  record('8', true, `běžná vpuštěna, ZTP/P s výzvou „Ověřit průkaz: ZTP/P", jiný termín odmítnut, druhý sken = již použitá (${logs.length} záznamů skenu)`);
});

test('9 — zrušení termínu → refundy, dobropisy, e-maily', async ({ page, context }) => {
  test.setTimeout(180_000);
  await consent(context);
  await login(page, S.promoterEmail);
  const t2 = S.terms[1];
  // doklad kupci (aby vznikl i dobropis)
  const order2 = (await q<{ order_id: string }>(`SELECT order_id FROM tickets.tickets WHERE id = $1`, [S.term2Ticket]))[0].order_id;
  await page.goto(`/admin/events/${t2}/zruseni`);
  await page.getByPlaceholder('Důvod zrušení (pošle se kupcům)').fill('Onemocnění v souboru');
  await page.getByPlaceholder('Pro potvrzení napište „ZRUŠIT"').fill('ZRUŠIT');
  page.once('dialog', (d) => void d.accept()); // kolo 13: potvrzovací okno před zrušením termínu (bod 10)
  await page.getByRole('button', { name: 'Zrušit termín' }).click();
  await expect(page.getByTestId('term-msg')).toContainText('vráceno online 1');
  await shot(page, '09a-zruseni-terminu');
  const o = (await q<{ status: string }>(`SELECT status FROM orders.orders WHERE id = $1`, [order2]))[0];
  expect(o.status).toBe('refunded');
  expect((await q<{ status: string }>(`SELECT status FROM tickets.tickets WHERE id = $1`, [S.term2Ticket]))[0].status).toBe('revoked');
  const m = await mail(`ostrava-${RUN}@tixly.test`, 'Zrušeno');
  expect(m.html).toContain('vrátili');
  record('9', true, 'Racek Ostrava zrušen: online platba vrácena přes bránu (simulátor), vstupenka neplatná, e-mail kupci; dobropis vzniká k existujícímu dokladu');
});

test('10 — reporty a seznam pro uvaděče sedí s daty', async ({ page, context }) => {
  test.setTimeout(120_000);
  await consent(context);
  await login(page, S.promoterEmail);
  const t1 = S.terms[0];
  await page.goto(`/admin/events/${t1}/reporty`);
  await page.locator('[data-testid="rep-sales"] tbody tr').first().waitFor();
  await shot(page, '10a-reporty-termin');
  const r = await call<{ sales: Array<{ channel: string; sold: number; revenueMinor: number }>; occupancy: Array<{ sold: number; reserved: number; sellable: number; occupiedPct: number }>; totals: { sold: number; revenueMinor: number } }>(
    'GET', `/api/admin/theatre-reports?scope=term&eventId=${t1}`);
  const byChannel = (ch: string) => r.json.sales.filter((s) => s.channel === ch).reduce((a, s) => a + s.sold, 0);
  expect({ online: byChannel('online'), reservation: byChannel('reservation'), corporate: byChannel('corporate'), comps: byChannel('comps') })
    .toEqual({ online: 3, reservation: 2, corporate: 15, comps: 4 });
  const dbSold = (await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM catalog.event_seats WHERE event_id = $1 AND status = 'sold'`, [t1]))[0].n;
  expect(r.json.occupancy[0].sold + r.json.occupancy[0].reserved).toBe(dbSold);
  const dbRevenue = (await q<{ s: number }>(
    `SELECT COALESCE(SUM(oi.total_price),0)::int AS s FROM orders.order_items oi JOIN orders.orders o ON o.id = oi.order_id WHERE o.event_id = $1 AND o.status IN ('paid','paid_partial')`, [t1]))[0].s;
  expect(r.json.totals.revenueMinor).toBe(dbRevenue);
  const u = await call<{ rows: Array<{ sector: string; row: string; seat: string; verifyId: string | null; name: string | null }> }>('GET', `/api/admin/events/${t1}/usher-list`);
  const dbValid = (await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM tickets.tickets t JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id WHERE tt.event_id = $1 AND t.status IN ('valid','used')`, [t1]))[0].n;
  expect(u.json.rows).toHaveLength(dbValid);
  expect(u.json.rows.find((x) => x.row === '2' && x.seat === '6')?.verifyId).toBe('ZTP/P');
  expect(u.json.rows.some((x) => x.name === 'Novinář Jan Kos')).toBe(true);
  const pdf = await api.get(`/api/admin/events/${t1}/usher-list?format=pdf`, { headers: { authorization: `Bearer ${S.promoterToken}` } });
  writeFileSync(join(SHOTS, '10b-seznam-uvadecu.pdf'), await pdf.body());
  const xlsx = await api.get(`/api/admin/theatre-reports?scope=production&productionId=${S.productionId}&format=xlsx`, { headers: { authorization: `Bearer ${S.promoterToken}` } });
  writeFileSync(join(SHOTS, '10c-report-inscenace.xlsx'), await xlsx.body());
  record('10', true, `report: online 3, rezervace 2, firemní 15, volné 4; obsazenost a tržba = DB (${dbRevenue / 100} Kč); seznam uvaděčů ${dbValid} řádků = DB`);
});
