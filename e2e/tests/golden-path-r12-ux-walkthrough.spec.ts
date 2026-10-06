/**
 * Kolo 12 / krok 1 — UX průchod administrací divadelní agentury (vlastník, pokladní, obsluha vstupu, kupec na mobilu).
 *
 * Každá úloha jde jako člověk: z /admin přes menu, odkazy a záložky (žádné adresy s ID). Měří se kliknutí, obrazovky,
 * screenshoty 1440 px (+ 390 px u klíčových obrazovek) a automatické nálezy (anglický text, technické termíny, kódy chyb,
 * viditelná ID, prompt/alert okna) — viz helpers/ux-meter.ts. Kde rozhraní nabízí kratší cestu (po opravách kroku 2),
 * helper ji použije; tentýž test tak měří stav před i po.
 *
 * Prostředí: lokální `next start` (BASE_URL) nad DB z `scripts/staging/create.sh --local` (demo agentura), tixly_app + RLS,
 * simulátor GoPay :3998, Mailpit :58225, lokální ARES :3997 (tento soubor). Výstup: UX_OUT (logs/r12/before|after).
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import pg from 'pg';
import { UxMeter } from './helpers/ux-meter';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const OWNER_URL = process.env.AUDIT_OWNER_URL ?? 'postgresql://neondb_owner:fixowner@localhost:55632/r12demo';
const OUT = process.env.UX_OUT ?? join(__dirname, '..', '..', 'logs', 'r12', 'before');
const OWNER = { email: process.env.UX_OWNER_EMAIL ?? 'demo@tixly-staging.test', pass: process.env.UX_OWNER_PASS ?? 'Demo2026!heslo' };
const RUN = Date.now().toString(36);
const PASS = 'Ux2026!heslo';
const CASHIER = `pokladna-${RUN}@agentura.test`;
const GATE = `vstup-${RUN}@agentura.test`;
const BUYER = `divak-${RUN}@tixly.test`;
const RESERVER = { email: `rez-${RUN}@tixly.test`, name: `Jana Rezervující ${RUN}`, phone: `+420 777 ${String(Date.now()).slice(-6, -3)} ${String(Date.now()).slice(-3)}` };
const RUN_IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
const PROD_TITLE = `Revizor ${RUN}`;
const CITY = 'Olomouc';
const ALFA = `Firma Alfa ${RUN.slice(-4)}`;
const PRESS = `Tisk premiéra ${RUN.slice(-4)}`;

mkdirSync(OUT, { recursive: true });
// úlohy na sebe navazují daty (jeden worker, sdílený stav); selhání úlohy se zaznamená jako nález „zablokováno" a průchod pokračuje
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 10_000, navigationTimeout: 20_000 });

let db: pg.Client;
let ares: Server;
let meter: UxMeter;
const T: { rBrno: string; rOstrava: string; hOstrava: string; ticketPlne: string; ticketZtpp: string; ticketOther: string; resCode: string; promoterId: string } =
  { rBrno: '', rOstrava: '', hOstrava: '', ticketPlne: '', ticketZtpp: '', ticketOther: '', resCode: '', promoterId: '' };
/** Úloha: chyba = nález „blocked" + screenshot, ne pád celého průchodu. */
function task(name: string, fn: (a: { browser: Browser }) => Promise<void>): void {
  test(name, async ({ browser }) => {
    try { await fn({ browser }); }
    catch (e) {
      meter?.note('blocked', (e as Error).message.split('\n')[0].slice(0, 200));
      try { await meter?.screen(`ERR-${name.split(' ')[0]}`, { skipAudit: true }); } catch { /* */ }
    }
  });
}
const q = async <R = Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<R[]> => (await db.query(sql, p)).rows as R[];

function floorPlanPng(): Buffer {
  const w = 600; const h = 400; const px = Buffer.alloc((w * 3 + 1) * h, 255);
  const dot = (cx: number, cy: number, r: number) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) px.fill(40, y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3); };
  for (let y = 20; y < 60; y++) for (let x = 150; x < 450; x++) px.fill(80, y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3);
  for (let row = 0; row < 2; row++) for (let s = 0; s < 8; s++) dot(130 + s * 48, 140 + row * 70, 9);
  for (let y = 0; y < h; y++) px[y * (w * 3 + 1)] = 0;
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); let c = 0xffffffff; for (const b of td) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } const crc = Buffer.alloc(4); crc.writeUInt32BE((c ^ 0xffffffff) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(px)), chunk('IEND', Buffer.alloc(0))]);
}
/** Malá fotka JPEG/PNG pro inscenaci. */
const PHOTO = join(OUT, 'foto-revizor.png');

async function ctxFor(browser: Browser, mobile = false): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(mobile
    ? { baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { baseURL: BASE, viewport: { width: 1440, height: 900 } });
  await ctx.setExtraHTTPHeaders({ 'x-real-ip': RUN_IP });
  await ctx.addInitScript(() => { try { window.localStorage.setItem('tixly.cookie-consent', JSON.stringify({ essential: true, analytics: false, marketing: false, decidedAt: new Date().toISOString() })); } catch { /* */ } });
  const page = await ctx.newPage();
  // prompt/confirm/alert: zaznamenat (nález) a odpovědět jako uživatel
  page.on('dialog', (d) => {
    meter?.note(`dialog-${d.type()}`, d.message().slice(0, 160));
    const m = d.message();
    if (d.type() === 'prompt') void d.accept(/Reference|platby|VS/i.test(m) ? 'VS 2026-15' : /datum/i.test(m) ? '' : 'Firma zrušila');
    else void d.accept();
  });
  return { ctx, page };
}
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();
async function login(page: Page, email: string, pass: string): Promise<void> {
  const s = sessions.get(email);
  if (s) {
    await page.context().addCookies(s.cookies);
    const items = s.origins.find((o) => o.origin === new URL(BASE).origin)?.localStorage ?? [];
    await page.context().addInitScript((kv: Array<{ name: string; value: string }>) => { for (const { name, value } of kv) { try { window.localStorage.setItem(name, value); } catch { /* */ } } }, items);
    await page.goto('/admin');
    return;
  }
  await page.goto('/cs/login', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Heslo').fill(pass);
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/auth/login')), page.getByRole('button', { name: /^Přihlásit$/ }).click()]);
  await page.waitForURL(/\/admin(?!\/?login)/, { timeout: 20_000 });
  sessions.set(email, await page.context().storageState());
}

/** Odkaz v levém menu (na mobilu případně po otevření menu). */
async function menu(page: Page, label: RegExp): Promise<boolean> {
  const toggle = page.getByRole('button', { name: /Menu|Otevřít menu/ });
  if (await toggle.isVisible().catch(() => false)) await meter.click(toggle);
  const link = page.getByRole('navigation').getByRole('link', { name: label }).first();
  if (!(await link.isVisible().catch(() => false))) return false;
  await meter.click(link);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  return true;
}
async function openProductions(page: Page): Promise<void> {
  if (await menu(page, /^Inscenace$/)) return;
  meter.note('nav', 'Inscenace nejsou v menu — jen přes „Vše" → „Produkce a reprízy"');
  if (!(await menu(page, /^Vše$/))) throw new Error('menu Vše chybí');
  await meter.click(page.getByRole('link', { name: /Produkce a reprízy|Inscenace/ }).first());
  await page.waitForURL(/\/admin\/productions$/);
}
async function openProduction(page: Page, title: string | RegExp): Promise<void> {
  await openProductions(page);
  const row = page.locator('div,li,tr').filter({ hasText: title }).filter({ has: page.getByTestId('open-production') }).last();
  await meter.click(row.getByTestId('open-production'));
  await page.waitForURL(/\/admin\/productions\/[0-9a-f-]{36}/);
}
/** Nástroj termínu (karta v záložce): inscenace → řádek termínu → (přímý odkaz | Upravit → záložka → karta). */
async function openTermTool(page: Page, production: string, city: string, tab: string, card: RegExp): Promise<void> {
  await openProduction(page, production);
  const row = page.getByTestId('term-row').filter({ hasText: city }).first();
  const direct = row.getByRole('link', { name: card });
  if (await direct.count()) { await meter.click(direct.first()); await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {}); return; }
  await meter.click(row.getByRole('link', { name: /Upravit|Otevřít/ }).first());
  await page.waitForURL(/\/admin\/events\/[0-9a-f-]{36}/);
  await meter.click(page.getByRole('navigation', { name: 'Sekce akce' }).getByRole('link', { name: tab }));
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  let c = page.getByRole('link', { name: card }).first();
  if (!(await c.isVisible().catch(() => false))) {
    const more = page.getByRole('button', { name: /Další funkce/ });
    if (await more.isVisible().catch(() => false)) await meter.click(more);
    c = page.getByRole('link', { name: card }).first();
  }
  await meter.click(c);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
}
async function msgOf(page: Page, testId: string): Promise<string> {
  const l = page.getByTestId(testId);
  await l.waitFor({ timeout: 15_000 }).catch(() => {});
  return ((await l.textContent().catch(() => '')) ?? '').trim();
}
async function pickOption(sel: Locator, text: RegExp): Promise<void> {
  const opt = sel.locator('option').filter({ hasText: text }).first();
  await meter.select(sel, (await opt.getAttribute('value'))!);
}

test.beforeAll(async ({ playwright }) => {
  db = new pg.Client({ connectionString: OWNER_URL });
  await db.connect();
  writeFileSync(PHOTO, floorPlanPng());
  ares = createServer((req, res) => {
    const ico = (req.url ?? '').split('/').pop();
    if (ico === '25596641') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ico, obchodniJmeno: 'Firma Alfa s.r.o.', dic: 'CZ27082440', sidlo: { textovaAdresa: 'Horní náměstí 1, 779 00 Olomouc' }, datumVzniku: '2004-01-01' })); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((r) => ares.listen(3997, '127.0.0.1', r));
  const api = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-real-ip': RUN_IP } });
  T.promoterId = (await q<{ id: string }>(`SELECT p.id FROM platform.promoters p JOIN platform.promoter_members m ON m.promoter_id = p.id JOIN identity.users u ON u.id = m.user_id WHERE u.email = $1`, [OWNER.email]))[0].id;
  // pokladní a obsluha vstupu: účty jako po pozvání vlastníkem (role box_office / staff)
  for (const [email, role] of [[CASHIER, 'box_office'], [GATE, 'staff']] as const) {
    const r = await api.post('/api/auth/register', { data: { email, password: PASS, name: role === 'staff' ? 'Brigádník Vstup' : 'Brigádnice Pokladna' }, headers: { origin: BASE } });
    expect(r.status(), await r.text()).toBe(200);
    await db.query(`INSERT INTO platform.promoter_members (promoter_id, user_id, role) SELECT $1, id, $2 FROM identity.users WHERE email = $3`, [T.promoterId, role, email]);
  }
  await api.dispose();
  const terms = await q<{ id: string; title: string; city: string }>(
    `SELECT e.id, e.title, v.city FROM catalog.events e JOIN catalog.venues v ON v.id = e.venue_id WHERE e.promoter_id = $1 ORDER BY e.date_start`, [T.promoterId]);
  T.rBrno = terms.find((t) => t.title === 'Racek' && t.city === 'Brno')!.id;
  T.rOstrava = terms.find((t) => t.title === 'Racek' && t.city === 'Ostrava')!.id;
  T.hOstrava = terms.find((t) => t.title === 'Hamlet' && t.city === 'Ostrava')!.id;
  // rezervace s platbou na pokladně — vlastník je zapíná jednou v nastavení termínu (mimo měřené úlohy)
  await db.query(`UPDATE catalog.events SET reservations_enabled = true WHERE id = $1`, [T.rBrno]);
});
test.afterAll(async () => {
  meter?.save(join(OUT, 'ux-results.json'));
  await db?.end();
  await new Promise((r) => ares?.close(r));
});

// ───────────────────────── Vlastník agentury (desktop 1440) ─────────────────────────
test.describe('vlastník', () => {
  let ctx: BrowserContext; let page: Page;
  test.beforeAll(async ({ browser }) => {
    ({ ctx, page } = await ctxFor(browser));
    meter = new UxMeter(OUT, page);
    await login(page, OWNER.email, OWNER.pass);
  });
  test.afterAll(async () => { await ctx?.close(); });

  task('1 — nová inscenace s fotkou a obsazením', async () => {
    test.setTimeout(180_000);
    meter.start('1 inscenace');
    await page.goto('/admin');
    await meter.screen('1-00-prehled', { mobile: true });
    await openProductions(page);
    await meter.screen('1-01-inscenace-seznam');
    await meter.fill(page.getByPlaceholder(/Název inscenace/), PROD_TITLE);
    await meter.click(page.getByRole('button', { name: /^Vytvořit/ }));
    await page.waitForURL(/\/admin\/productions\/[0-9a-f-]{36}/);
    for (const [label, v] of [['Podtitul', 'Komedie'], ['Autor', 'N. V. Gogol'], ['Režie', 'Eva Malá'], ['Délka (min)', '140'], ['Přestávka (min)', '20'], ['Žánr', 'činohra']] as const) {
      await meter.fill(page.getByLabel(label, { exact: false }).first(), v);
    }
    // obsazení: strukturovaně (po opravě) nebo volný text „role: jméno"
    const castRole = page.getByPlaceholder(/^Role/).first();
    if (await castRole.isVisible().catch(() => false)) {
      for (const [role, name] of [['Chlestakov', 'Petr Novák'], ['Hejtman', 'Jan Dvořák']]) {
        await meter.fill(page.getByPlaceholder(/^Role/).last(), role);
        await meter.fill(page.getByPlaceholder(/^Jméno/).last(), name);
        await meter.click(page.getByRole('button', { name: /Přidat roli/ }));
      }
    } else {
      await meter.fill(page.getByLabel(/Obsazení/).first(), 'Chlestakov: Petr Novák\nHejtman: Jan Dvořák');
    }
    // fotka: nahrání souboru (pokud karta umí), jinak jen odkaz
    const file = page.locator('input[type="file"]').first();
    if (await file.count()) {
      await file.setInputFiles(PHOTO);
      await page.waitForTimeout(1500);
    } else {
      meter.note('stuck', 'Fotku nelze nahrát — jen „Fotky (jeden odkaz na řádek)"');
      await meter.fill(page.getByLabel(/Fotky/).first(), 'https://example.invalid/revizor.jpg');
    }
    await meter.click(page.getByRole('button', { name: /Uložit kartu|Uložit/ }).first());
    const msg = await msgOf(page, 'production-msg');
    meter.note('result', `uložení karty: ${msg}`);
    await meter.screen('1-02-karta-inscenace', { mobile: true });
  });

  task('2 — nové místo a sál v novém městě: generátor + obkreslení podkladu', async () => {
    test.setTimeout(240_000);
    meter.start('2 místo a sál');
    await page.goto('/admin');
    if (!(await menu(page, /^Sály$|^Místa a sály$/))) throw new Error('menu Sály chybí');
    await meter.screen('2-01-sály');
    await meter.fill(page.getByTestId('place-name'), `Moravské divadlo ${RUN}`);
    await meter.fill(page.getByTestId('place-city'), CITY);
    await meter.fill(page.getByTestId('place-address'), 'Horní náměstí 22, Olomouc');
    await meter.click(page.getByTestId('place-add'));
    const card = page.locator('[data-testid="place-card"]', { hasText: `Moravské divadlo ${RUN}` });
    await card.waitFor();
    await meter.fill(card.getByTestId('hall-name'), 'Velký sál');
    await meter.click(card.getByTestId('hall-add'));
    await page.waitForURL(/seating-chart\/editor/);
    await meter.screen('2-02-editor-prazdny');
    await meter.fill(page.getByLabel(/Název sekce|^Sekce/).first(), 'Přízemí');
    await meter.fill(page.getByLabel('Počet řad'), '6');
    await meter.fill(page.getByLabel('Míst v řadě'), '12');
    await meter.click(page.getByTestId('generate-section'));
    await meter.fill(page.getByTestId('zone-name'), 'Zóna A');
    await meter.click(page.getByTestId('zone-add'));
    await page.keyboard.press('Control+a').catch(() => {});
    await meter.click(page.getByTestId('zone-assign-Zóna A'));
    // podklad + obkreslení jedné řady nástrojem Řada
    await page.locator('input[type="file"][accept*="image"]').first().setInputFiles(PHOTO);
    meter.note('result', 'podklad nahrán');
    const underlay = page.getByTestId('chart-underlay');
    await underlay.waitFor({ timeout: 15_000 });
    await page.keyboard.press('2');
    const canvas = page.locator('svg[aria-label="Seating chart editor canvas"], svg[aria-label="Plátno editoru plánku"]').first();
    const ub = (await underlay.boundingBox())!; const cb = (await canvas.boundingBox())!;
    const y = ub.y + ub.height * (280 / 400) - cb.y;
    await meter.click(canvas, { position: { x: ub.x - cb.x + ub.width * (130 / 600), y } });
    await meter.click(canvas, { position: { x: ub.x - cb.x + ub.width * (466 / 600), y } });
    await meter.fill(page.locator('input[type="number"][max="200"]'), '8');
    await meter.click(page.getByRole('button', { name: 'Přidat řadu' }));
    await meter.screen('2-03-editor-generator-obkresleni');
    await meter.click(page.getByRole('button', { name: /Uložit (layout|plánek)/ }));
    await page.waitForTimeout(1500);
    await meter.screen('2-04-editor-ulozeno');
    const saved = await q(`SELECT 1 FROM catalog.venue_seating_charts c JOIN catalog.venues v ON v.id = c.venue_id WHERE v.city = $1 AND v.name LIKE $2`, [CITY, `Moravské divadlo ${RUN}%`]);
    meter.note('result', `plánek uložen: ${saved.length === 1}`);
    // zpět z editoru
    const back = page.getByRole('link', { name: /Zpět/ }).first();
    if (await back.isVisible().catch(() => false)) {
      await meter.click(back);
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      if ((await page.title()).includes('404') || (await page.getByText(/404|nenalezena|could not be found/i).count())) meter.note('stuck', `„Zpět" z editoru vede na neexistující stránku (${new URL(page.url()).pathname})`);
      await meter.screen('2-05-po-zpet');
    }
  });

  task('3 — nový termín v novém sále, převzetí ceníku, šablona kategorií, zveřejnění', async () => {
    test.setTimeout(180_000);
    meter.start('3 termín');
    await page.goto('/admin');
    await openProduction(page, /^Racek|Racek/);
    await meter.screen('3-01-karta-racek');
    await meter.select(page.getByTestId('term-city'), { label: CITY });
    const venueSel = page.getByTestId('term-venue');
    await pickOption(venueSel, new RegExp(`Moravské divadlo ${RUN}`));
    const copy = page.getByTestId('term-copy');
    await pickOption(copy, /Brno/);
    const day = new Date(Date.now() + 50 * 86_400_000).toISOString().slice(0, 10);
    await meter.fill(page.getByTestId('term-date'), day);
    await meter.fill(page.getByTestId('term-time'), '19:30');
    await meter.click(page.getByTestId('term-create'));
    const msg = await msgOf(page, 'production-msg');
    meter.note('result', `založení termínu: ${msg}`);
    await meter.screen('3-02-termin-zalozen');
    await page.reload();
    const status = await page.getByTestId('term-row').filter({ hasText: CITY }).first().textContent();
    meter.note('result', `stav termínu po založení: ${status}`);
    // slevové kategorie ze šablony
    await openTermTool(page, 'Racek', CITY, 'Vstupenky', /Slevové kategorie/);
    await meter.screen('3-03-kategorie-pred');
    await meter.click(page.getByTestId('apply-template'));
    await page.waitForTimeout(1000);
    await meter.screen('3-04-kategorie-sablona');
    const cats = await q(`SELECT pc.name FROM catalog.price_categories pc JOIN catalog.events e ON e.id = pc.event_id JOIN catalog.venues v ON v.id = e.venue_id WHERE v.city = $1 AND e.promoter_id = $2`, [CITY, T.promoterId]);
    meter.note('result', `kategorie po šabloně: ${cats.length}`);
    const ev = await q<{ status: string; tt: number }>(`SELECT e.status, (SELECT COUNT(*) FROM catalog.ticket_types t WHERE t.event_id = e.id)::int AS tt FROM catalog.events e JOIN catalog.venues v ON v.id = e.venue_id WHERE v.city = $1 AND e.promoter_id = $2`, [CITY, T.promoterId]);
    meter.note('result', `termín: stav ${ev[0]?.status}, typů vstupenek ${ev[0]?.tt}`);
  });

  task('4 — blokace pro firmu a tisk, uvolnění části do prodeje', async () => {
    test.setTimeout(180_000);
    meter.start('4 blokace');
    await page.goto('/admin');
    await openTermTool(page, 'Racek', 'Brno', 'Vstupenky', /Blokace míst|Blokace/);
    await meter.screen('4-01-blokace');
    // uživatel nejdřív zkusí celou sekci (balkon je v demo datech už celý blokovaný pro Firmu XY)
    await meter.fill(page.getByTestId('block-name'), ALFA);
    await meter.select(page.locator('select').filter({ hasText: /vybraná místa/ }), { label: 'Balkon' });
    await meter.click(page.getByTestId('block-create'));
    const m1 = await msgOf(page, 'blocks-msg');
    meter.note('result', `firma (celý balkon): ${m1}`);
    const alfaCount = (await q<{ n: number }>(`SELECT COUNT(bs.seat_id)::int n FROM catalog.seat_blocks b LEFT JOIN catalog.seat_block_seats bs ON bs.block_id = b.id WHERE b.event_id = $1 AND b.name = $2`, [T.rBrno, ALFA]))[0]?.n ?? 0;
    if (alfaCount === 0) {
      if (await q(`SELECT 1 FROM catalog.seat_blocks WHERE event_id = $1 AND name = $2`, [T.rBrno, ALFA]).then((r) => r.length)) meter.note('stuck', `Blokace celé sekce, kde už nic volného není, se založila s 0 místy bez varování (hláška: ${m1})`);
      await meter.screen('4-01b-blokace-prazdna');
      await meter.fill(page.getByTestId('block-name'), `${ALFA} B`);
      await meter.select(page.locator('select').filter({ hasText: /vybraná místa/ }), '');
      for (let n = 1; n <= 8; n++) await meter.click(page.locator('svg[aria-label="Plánek s blokacemi"] circle').filter({ has: page.locator('title', { hasText: new RegExp(`Přízemí řada 6 místo ${n} —`) }) }));
      await meter.click(page.getByTestId('block-create'));
      meter.note('result', `firma (8 vybraných míst): ${await msgOf(page, 'blocks-msg')}`);
    }
    await meter.fill(page.getByTestId('block-name'), PRESS);
    for (const s of ['3', '4']) await meter.click(page.locator('svg[aria-label="Plánek s blokacemi"] circle').filter({ has: page.locator('title', { hasText: new RegExp(`Přízemí řada 2 místo ${s} —`) }) }));
    await meter.click(page.getByTestId('block-create'));
    meter.note('result', `tisk: ${await msgOf(page, 'blocks-msg')}`);
    await meter.screen('4-02-blokace-zalozeny');
    // uvolnit 5 míst z Firma Alfa: vybrat místa na plánku → „Uvolnit vybraná"
    const alfa = page.locator('svg[aria-label="Plánek s blokacemi"] circle').filter({ has: page.locator('title', { hasText: new RegExp(ALFA) }) });
    for (let i = 0; i < 5; i++) await meter.click(alfa.nth(i));
    const dialogsBefore = meter.findings.filter((f) => f.kind.startsWith('dialog')).length;
    await meter.click(page.locator('[data-testid="blocks-table"] tr', { hasText: ALFA }).last().getByRole('button', { name: /Uvolnit vybraná/ }));
    const confirmPanel = page.getByRole('alertdialog').or(page.getByTestId('confirm-dialog'));
    if (await confirmPanel.isVisible({ timeout: 1500 }).catch(() => false)) {
      await meter.screen('4-03-potvrzeni-uvolneni');
      await meter.click(confirmPanel.getByRole('button', { name: /Uvolnit|Potvrdit|Ano/ }).first());
    } else if (meter.findings.filter((f) => f.kind.startsWith('dialog')).length === dialogsBefore) {
      meter.note('stuck', 'Uvolnění blokace bez potvrzení');
    }
    meter.note('result', `uvolnění: ${await msgOf(page, 'blocks-msg')}`);
    await meter.screen('4-04-po-uvolneni');
    const st = await q<{ state: string; n: number }>(`SELECT bs.state, COUNT(*)::int n FROM catalog.seat_blocks b JOIN catalog.seat_block_seats bs ON bs.block_id = b.id WHERE b.event_id = $1 AND b.name LIKE $2 GROUP BY 1 ORDER BY 1`, [T.rBrno, `${ALFA}%`]);
    meter.note('result', `${ALFA}: ${JSON.stringify(st)}`);
  });

  task('5 — firemní objednávka na fakturu a označení zaplacení', async () => {
    test.setTimeout(180_000);
    meter.start('5 firemní');
    await page.goto('/admin');
    await openTermTool(page, 'Racek', 'Brno', 'Vstupenky', /Firemní objednávky/);
    await meter.screen('5-01-firemni');
    await meter.fill(page.getByPlaceholder('IČO'), '25596641');
    await meter.click(page.getByRole('button', { name: /Načíst z ARES|Načíst údaje/ }));
    await expect(page.getByPlaceholder('Název firmy')).toHaveValue('Firma Alfa s.r.o.', { timeout: 10_000 });
    await meter.fill(page.getByPlaceholder('Jméno'), 'Jan Nákupčí');
    await meter.fill(page.getByPlaceholder('E-mail'), `nakup-${RUN}@firma-alfa.test`);
    await pickOption(page.locator('select').filter({ hasText: 'Volná místa' }), new RegExp(`${ALFA} B`));
    await meter.click(page.getByRole('button', { name: /Vybrat vše/ }));
    await meter.click(page.getByRole('button', { name: /Vytvořit objednávku a fakturu/ }));
    meter.note('result', `objednávka: ${await msgOf(page, 'corp-msg')}`);
    await meter.screen('5-02-faktura');
    await meter.click(page.locator('[data-testid="corp-table"] tr', { hasText: 'Firma Alfa' }).getByRole('button', { name: /Zaplaceno|Označit zaplacené/ }).first());
    const panel = page.getByTestId('confirm-dialog');
    if (await panel.isVisible({ timeout: 1500 }).catch(() => false)) {
      const ref = panel.locator('input').first();
      if (await ref.isVisible().catch(() => false)) await meter.fill(ref, 'VS 2026-15');
      await meter.screen('5-03-potvrzeni-zaplaceni');
      await meter.click(panel.getByRole('button', { name: /Zaplaceno|Potvrdit|Označit/ }).first());
    }
    await page.waitForTimeout(1500);
    meter.note('result', `zaplaceno: ${await msgOf(page, 'corp-msg')}`);
    await meter.screen('5-04-zaplaceno');
  });

  task('6 — promo kód omezený na kategorii', async () => {
    test.setTimeout(120_000);
    meter.start('6 promo kód');
    await page.goto('/admin');
    if (await menu(page, /^Marketing$/)) {
      const link = page.getByRole('link', { name: /Promo kódy|Slevové kódy/ }).first();
      if (await link.isVisible().catch(() => false)) await meter.click(link);
      else { meter.note('nav', 'Marketing nemá odkaz na promo kódy — jen přes „Vše"'); await menu(page, /^Vše$/); await meter.click(page.getByRole('link', { name: /Promo kódy|Slevové kódy/ }).first()); }
    }
    await page.waitForURL(/promo-codes/);
    await meter.screen('6-01-promo');
    const code = `STUDENT${RUN.toUpperCase().slice(-4)}`;
    await meter.fill(page.getByPlaceholder('LETO2026'), code);
    const val = page.getByLabel(/Hodnota|Sleva/).first();
    await meter.fill(val.or(page.locator('form input[type="number"]').first()).first(), '10');
    await pickOption(page.getByLabel('Termín pro omezení'), /Racek.*Brno|Racek/);
    await meter.click(page.getByTestId('promo-restrictions').getByLabel(/Student/).first());
    await meter.screen('6-02-promo-vyplneno');
    await meter.click(page.getByRole('button', { name: /Vytvořit kód/ }));
    await page.waitForTimeout(1200);
    await meter.screen('6-03-promo-vytvoren');
    const row = await q<{ cats: string[] }>(`SELECT applicable_category_codes AS cats FROM marketing.promo_codes WHERE code = $1`, [code]).catch(() => []);
    meter.note('result', `kód ${code}: ${JSON.stringify(row)}`);
  });

  task('7 — přesun a zrušení termínu', async () => {
    test.setTimeout(180_000);
    meter.start('7 přesun a zrušení');
    await page.goto('/admin');
    await openTermTool(page, 'Hamlet', 'Ostrava', 'Vstupenky', /Zrušení a přesun/);
    await meter.screen('7-01-zruseni-presun');
    const when = new Date(Date.now() + 60 * 86_400_000); when.setHours(19, 0, 0, 0);
    await meter.fill(page.locator('input[type="datetime-local"]').first(), when.toISOString().slice(0, 16));
    await meter.fill(page.getByPlaceholder('Důvod přesunu'), 'Rekonstrukce jeviště');
    const d0 = meter.findings.filter((f) => f.kind.startsWith('dialog')).length;
    await meter.click(page.getByRole('button', { name: /Přesunout a informovat kupce|Přesunout termín/ }).first());
    const panel = page.getByTestId('confirm-dialog');
    if (await panel.isVisible({ timeout: 1500 }).catch(() => false)) { await meter.screen('7-02-potvrzeni-presunu'); await meter.click(panel.getByRole('button', { name: /Přesunout/ }).first()); }
    else if (meter.findings.filter((f) => f.kind.startsWith('dialog')).length === d0) meter.note('stuck', 'Přesun termínu (e-mail všem kupcům) bez potvrzení');
    meter.note('result', `přesun: ${await msgOf(page, 'term-msg')}`);
    await meter.screen('7-03-po-presunu');
    await meter.fill(page.getByPlaceholder(/Důvod zrušení/), 'Onemocnění v souboru');
    await meter.fill(page.getByPlaceholder(/ZRUŠIT/), 'ZRUŠIT');
    await meter.click(page.getByRole('button', { name: 'Zrušit termín' }));
    await page.waitForTimeout(1500);
    meter.note('result', `zrušení: ${await msgOf(page, 'term-msg')}`);
    await meter.screen('7-04-zruseno');
  });

  task('8 — reporty termínu a seznam pro uvaděčky', async () => {
    test.setTimeout(120_000);
    meter.start('8 reporty');
    await page.goto('/admin');
    await openTermTool(page, 'Racek', 'Brno', 'Vstupenky', /Divadelní reporty|Reporty/);
    await page.locator('[data-testid="rep-sales"]').waitFor();
    await meter.screen('8-01-reporty', { mobile: true });
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }).catch(() => null), meter.click(page.getByRole('button', { name: /Seznam pro uvaděče|uvaděčky/ }).first())]);
    meter.note('result', `seznam pro uvaděče: ${dl ? dl.suggestedFilename() : 'nic se nestáhlo'}`);
    if (dl) await dl.saveAs(join(OUT, '8-seznam-uvadecu.pdf'));
  });
});

// ───────────────────────── Kupec na mobilu (390) ─────────────────────────
test.describe('kupec na mobilu', () => {
  task('K — najít představení ve svém městě, místa a kategorie, zaplatit; rezervace', async ({ browser }) => {
    test.setTimeout(300_000);
    const { ctx, page } = await ctxFor(browser, true);
    meter.setPage(page);
    meter.start('K kupec');
    await page.goto('/cs');
    await meter.screen('K-01-uvod');
    const program = page.getByRole('link', { name: /^Program/ }).first();
    if (await program.isVisible().catch(() => false)) {
      await meter.click(program);
      await page.waitForURL(/program/);
      await meter.select(page.getByTestId('program-city'), { label: 'Brno' });
      const f = page.getByRole('button', { name: /Filtrovat|Hledat/ });
      if (await f.isVisible().catch(() => false)) await meter.click(f);
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await meter.screen('K-02-program-brno');
      await meter.click(page.locator('li,tr,div').filter({ hasText: 'Racek' }).getByRole('link', { name: /Vstupenky/ }).first());
    } else {
      meter.note('stuck', 'Na webu není odkaz na program podle měst ani filtr města');
      const akce = page.getByRole('link', { name: /^Akce$/ }).first();
      if (await akce.isVisible().catch(() => false)) await meter.click(akce);
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await meter.screen('K-02-akce');
      await meter.click(page.getByRole('link', { name: /Racek/ }).first());
    }
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await meter.screen('K-03-detail');
    const buy = page.getByRole('link', { name: /Vybrat místa|Koupit/ }).or(page.getByRole('button', { name: /Vybrat místa|Koupit/ })).first();
    await meter.click(buy);
    await page.waitForURL(/\/seats/);
    await page.locator('svg[aria-label="Plán sálu"] [aria-label^="Sektor "]').first().waitFor({ timeout: 20_000 });
    const free = page.locator('svg[aria-label="Plán sálu"] [aria-label*="řada 4, sedadlo"][aria-label$="available"], svg[aria-label="Plán sálu"] [aria-label*="řada 4, sedadlo"][aria-label$="volné"]');
    if (!(await free.count())) await meter.click(page.locator('[aria-label^="Sektor Přízemí, dostupných"]').first());
    await meter.click(free.nth(0)); await meter.click(free.nth(1));
    await meter.screen('K-04-mista');
    await meter.click(page.getByRole('button', { name: /Pokračovat/ }));
    await page.waitForURL(/\/seats\/kategorie/);
    const rows = page.locator('[data-testid="seat-category-row"] select');
    await pickOption(rows.nth(0), /^Plné/);
    await pickOption(rows.nth(1), /^ZTP\/P/);
    await meter.fill(page.getByPlaceholder('E-mail'), BUYER);
    await meter.fill(page.getByPlaceholder('Jméno a příjmení'), 'Eva Divačka');
    await meter.screen('K-05-kategorie');
    await meter.click(page.getByRole('button', { name: 'Zaplatit' }));
    await page.waitForURL(/localhost:3998\/gw\//, { timeout: 20_000 });
    await meter.click(page.getByTestId('gw-pay'));
    await page.waitForURL((u) => u.href.startsWith(BASE), { timeout: 20_000 });
    await meter.screen('K-06-potvrzeni');
    // rezervace (platba na pokladně)
    meter.start('K kupec — rezervace');
    await page.goto(`/cs/events/${T.rBrno}/seats`);
    await page.locator('svg[aria-label="Plán sálu"] [aria-label^="Sektor "]').first().waitFor({ timeout: 20_000 });
    const free5 = page.locator('svg[aria-label="Plán sálu"] [aria-label*="řada 5, sedadlo"][aria-label$="available"], svg[aria-label="Plán sálu"] [aria-label*="řada 5, sedadlo"][aria-label$="volné"]');
    if (!(await free5.count())) await meter.click(page.locator('[aria-label^="Sektor Přízemí, dostupných"]').first());
    await meter.click(free5.nth(0));
    await meter.click(page.getByRole('button', { name: /Pokračovat/ }));
    await page.waitForURL(/\/seats\/kategorie/);
    await meter.fill(page.getByPlaceholder('E-mail'), RESERVER.email);
    await meter.fill(page.getByPlaceholder('Jméno a příjmení'), RESERVER.name);
    await meter.fill(page.getByPlaceholder(/Telefon/), RESERVER.phone);
    const rb = page.getByTestId('reserve-box-office');
    if (await rb.isVisible().catch(() => false)) {
      await meter.click(rb);
      T.resCode = ((await page.getByTestId('reservation-code').textContent()) ?? '').trim();
      await meter.screen('K-07-rezervace');
    } else meter.note('stuck', 'Rezervace na pokladně není u termínu zapnutá (kupec ji nevidí)');
    await ctx.close();
    // vstupenky pro vstup: plné + ZTP/P z tohoto nákupu, jiný termín (Racek Ostrava) koupený mimo měření
    const tk = await q<{ id: string; cat: string }>(`SELECT t.id, t.price_category_name AS cat FROM tickets.tickets t JOIN orders.orders o ON o.id = t.order_id JOIN identity.users u ON u.id = o.user_id WHERE u.email = $1`, [BUYER]);
    T.ticketPlne = tk.find((t) => t.cat === 'Plné')?.id ?? ''; T.ticketZtpp = tk.find((t) => /ZTP/.test(t.cat ?? ''))?.id ?? '';
    meter.note('result', `vstupenky kupce: ${tk.length}, rezervace ${T.resCode || '—'}`);
  });
});

// ───────────────────────── Pokladní (desktop) ─────────────────────────
test.describe('pokladní', () => {
  test.beforeAll(async ({ browser }) => {
    // jiný termín pro kontrolu „Jiný termín" u vstupu — nákup mimo měření
    const { ctx, page } = await ctxFor(browser, true);
    await page.goto(`/cs/events/${T.rOstrava}/seats`);
    await page.locator('svg[aria-label="Plán sálu"] [aria-label^="Sektor "]').first().waitFor({ timeout: 20_000 });
    const c = page.locator('svg[aria-label="Plán sálu"] [aria-label$="available"], svg[aria-label="Plán sálu"] [aria-label$="volné"]');
    if (!(await c.count())) await page.locator('[aria-label^="Sektor "][aria-label*="dostupných"]').first().click();
    await c.nth(3).click();
    await page.getByRole('button', { name: /Pokračovat/ }).click();
    await page.waitForURL(/\/seats\/kategorie/);
    await page.getByPlaceholder('E-mail').fill(`ostrava-${RUN}@tixly.test`);
    await page.getByPlaceholder('Jméno a příjmení').fill('Petr Ostravák');
    await page.getByRole('button', { name: 'Zaplatit' }).click();
    await page.waitForURL(/localhost:3998\/gw\//, { timeout: 20_000 });
    await page.getByTestId('gw-pay').click();
    await page.waitForURL((u) => u.href.startsWith(BASE), { timeout: 20_000 });
    await ctx.close();
    await expect.poll(async () => (await q(`SELECT t.id FROM tickets.tickets t JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id WHERE tt.event_id = $1`, [T.rOstrava])).length, { timeout: 30_000 }).toBeGreaterThan(0);
    T.ticketOther = (await q<{ id: string }>(`SELECT t.id FROM tickets.tickets t JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id WHERE tt.event_id = $1 LIMIT 1`, [T.rOstrava]))[0].id;
  });

  task('P — rezervace: vyhledání a platba na pokladně, prodej na místě, tisk', async ({ browser }) => {
    test.setTimeout(240_000);
    const { ctx, page } = await ctxFor(browser);
    meter.setPage(page);
    meter.start('P pokladna');
    await login(page, CASHIER, PASS);
    await meter.screen('P-01-prehled-pokladni', { mobile: true });
    // rezervace: jedno vyhledávací pole (pokladna → rezervace), jinak přes akci
    if (await menu(page, /^Pokladna$/)) {
      const resLink = page.getByRole('link', { name: /Rezervace/ }).first();
      if (await resLink.isVisible().catch(() => false)) await meter.click(resLink);
      else {
        meter.note('nav', 'Z Pokladny nevede cesta k rezervacím — přes Akce → Upravit → Vstupenky → Rezervace na pokladně');
        await menu(page, /^Akce$/);
        const racek = page.locator('tr').filter({ hasText: 'Racek' });
        await racek.first().waitFor({ timeout: 15_000 });
        await meter.screen('P-02a-seznam-akci');
        const brno = racek.filter({ hasText: 'Brno' });
        if (!(await brno.count())) meter.note('stuck', `Seznam akcí: ${await racek.count()}× „Racek" bez města — pokladní nepozná, který termín je Brno`);
        // seznam ukazuje datum slovy („27. října 2026") — pokladní si musí termín dohledat podle data
        const ds = (await q<{ d: Date }>(`SELECT date_start AS d FROM catalog.events WHERE id = $1`, [T.rBrno]))[0].d;
        const day = new Date(ds).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Prague' });
        const row = (await brno.count()) ? brno.first() : racek.filter({ hasText: day }).first();
        await meter.click(row.getByRole('link', { name: /^Upravit$|^Otevřít$/ }).first());
        await meter.click(page.getByRole('navigation', { name: 'Sekce akce' }).getByRole('link', { name: 'Vstupenky' }));
        await meter.click(page.getByRole('link', { name: /Rezervace na pokladně/ }).first());
      }
    }
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await meter.screen('P-02-rezervace');
    const search = page.getByPlaceholder(/Kód, jméno, e-mail nebo telefon/).first();
    await meter.fill(search, RESERVER.phone.replace(/\s/g, '').slice(-6));
    await meter.click(page.getByRole('button', { name: /^Hledat$/ }).first());
    await page.waitForTimeout(800);
    const byPhone = await page.locator('[data-testid="res-table"] tr').filter({ hasText: T.resCode || RESERVER.name }).count();
    meter.note('result', `hledání podle telefonu (posledních 6 číslic): ${byPhone ? 'nalezeno' : 'NENALEZENO'}`);
    await meter.fill(search, RESERVER.name.split(' ')[0]);
    await meter.click(page.getByRole('button', { name: /^Hledat$/ }).first());
    await page.waitForTimeout(800);
    await meter.screen('P-03-rezervace-nalezena');
    const row = page.locator('[data-testid="res-table"] tr').filter({ hasText: T.resCode || RESERVER.name }).first();
    if (await row.count()) {
      await meter.click(row.getByRole('button', { name: /^Hotově$/ }));
      const panel = page.getByTestId('confirm-dialog');
      if (await panel.isVisible({ timeout: 1500 }).catch(() => false)) await meter.click(panel.getByRole('button', { name: /Zaplatit|Potvrdit|Hotově/ }).first());
      meter.note('result', `platba rezervace: ${await msgOf(page, 'res-msg')}`);
      await meter.screen('P-04-rezervace-zaplacena');
      const print = page.getByRole('link', { name: /Tisk|Vytisknout/ }).or(page.getByRole('button', { name: /Tisk|Vytisknout/ })).first();
      if (!(await print.isVisible().catch(() => false))) meter.note('stuck', 'Po zaplacení rezervace chybí tisk vstupenek');
    } else meter.note('stuck', 'Rezervace se nenašla');
    // prodej na místě
    meter.start('P pokladna — prodej na místě');
    await page.goto('/admin');
    await menu(page, /^Pokladna$/);
    await page.waitForURL(/\/admin\/pos/);
    await meter.screen('P-05-pos');
    const posEvent = page.locator('#pos-event');
    const brnoDay = (await q<{ d: string }>(`SELECT to_char(date_start AT TIME ZONE 'Europe/Prague', 'FMDD. FMMM. YYYY') AS d FROM catalog.events WHERE id = $1`, [T.rBrno]))[0].d;
    const posOpts = (await posEvent.locator('option').allTextContents()).filter((o) => o.includes('Racek'));
    if (posOpts.length > 1 && !posOpts.some((o) => o.includes('Brno'))) meter.note('stuck', `Pokladna: ${posOpts.length}× „Racek" bez města (${posOpts.join(' / ')})`);
    await pickOption(posEvent, posOpts.some((o) => o.includes('Brno')) ? /Racek.*Brno/ : new RegExp(`Racek.*${brnoDay.replace(/\./g, '\\.')}`));
    const tt = page.locator('#pos-tt');
    if (await tt.isVisible().catch(() => false)) await pickOption(tt, /Zóna A/);
    // řada 3, místo 7 (titulek tlačítka spojuje řadu a místo bez oddělovače — „Přízemí 37")
    const seat = page.locator('button[title^="Přízemí"]').filter({ hasText: /^7$/ }).nth(2);
    meter.note('result', `titulek sedadla v pokladně: ${await seat.getAttribute('title').catch(() => '?')}`);
    if (await seat.isVisible().catch(() => false)) await meter.click(seat);
    await meter.click(page.getByText(/^Hotově$/).first());
    await meter.screen('P-06-pos-vyplneno');
    await meter.click(page.getByRole('button', { name: /Vystavit (lístek|vstupenku)|Prodat/ }));
    await page.waitForTimeout(1500);
    await meter.screen('P-07-pos-vystaveno');
    const printBtn = page.getByRole('link', { name: /Tisk|Vytisknout/ }).or(page.getByRole('button', { name: /Tisk|Vytisknout/ })).first();
    if (await printBtn.isVisible().catch(() => false)) {
      const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 5000 }).catch(() => null), page.evaluate(() => { (window as unknown as { print: () => void }).print = () => { (window as unknown as { __printed: boolean }).__printed = true; }; }).then(() => meter.click(printBtn))]);
      meter.note('result', `tisk: ${popup ? `nové okno ${new URL(popup.url()).pathname}` : 'window.print'}`);
      if (popup) { await popup.waitForLoadState().catch(() => {}); await popup.close().catch(() => {}); }
    } else meter.note('stuck', 'Po prodeji chybí tisk vstupenky');
    await ctx.close();
  });
});

// ───────────────────────── Obsluha vstupu (mobil 390) ─────────────────────────
test.describe('vstup', () => {
  task('V — skenování na mobilu: běžná, Ověřit průkaz, Jiný termín, Už použito', async ({ browser }) => {
    test.setTimeout(180_000);
    const { ctx, page } = await ctxFor(browser, true);
    meter.setPage(page);
    meter.start('V vstup');
    await login(page, GATE, PASS);
    await meter.screen('V-01-prehled-mobil');
    const sidebarW = await page.evaluate(() => document.querySelector('aside')?.getBoundingClientRect().width ?? 0);
    if (sidebarW > 200) meter.note('stuck', `Na mobilu zabírá levé menu ${Math.round(sidebarW)} px z 390`);
    if (!(await menu(page, /^Vstup$/))) throw new Error('menu Vstup chybí');
    await page.waitForURL(/scanner/);
    await meter.screen('V-02-skener');
    const sel = page.locator('select').filter({ hasText: /vyber akci|vyberte představení|vyberte termín/ }).first();
    if (await sel.isVisible().catch(() => false)) await pickOption(sel, /Racek/);
    const done = page.getByRole('button', { name: /^Hotovo$/ });
    if (await done.isVisible().catch(() => false)) await meter.click(done);
    const scan = async (id: string, name: string) => {
      await meter.fill(page.getByTestId('scanner-ticket-input'), id);
      await Promise.all([page.waitForResponse((r) => r.url().includes('/api/admin/scanner/validate')), meter.click(page.getByRole('button', { name: /Ověřit|Validovat|Odbavit/ }).last())]);
      await page.waitForTimeout(400);
      const vib = await page.evaluate(() => (window as unknown as { __vib?: unknown[] }).__vib?.slice(-1)[0] ?? null);
      const snd = await page.evaluate(() => (window as unknown as { __snd?: unknown[] }).__snd?.slice(-1)[0] ?? null);
      meter.note('result', `${name}: vibrace=${JSON.stringify(vib)} zvuk=${JSON.stringify(snd)}`);
      await meter.screen(name);
    };
    await page.evaluate(() => {
      const w = window as unknown as { __vib: unknown[]; __snd: unknown[] };
      w.__vib = []; w.__snd = [];
      try { Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p: unknown) => { w.__vib.push(p); return true; } }); } catch { /* */ }
      const AC = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
      if (AC) { const orig = AC.prototype.createOscillator; AC.prototype.createOscillator = function (this: AudioContext) { const o = orig.call(this); const f = o.frequency; setTimeout(() => w.__snd.push(Math.round(f.value)), 0); return o; }; }
    });
    await scan(T.ticketPlne, 'V-03-bezna');
    await scan(T.ticketZtpp, 'V-04-overit-prukaz');
    await scan(T.ticketOther, 'V-05-jiny-termin');
    await scan(T.ticketPlne, 'V-06-uz-pouzito');
    await ctx.close();
  });
});
