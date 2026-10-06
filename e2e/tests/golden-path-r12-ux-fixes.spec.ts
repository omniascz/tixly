/**
 * Kolo 12 / krok 2 — opravy zaseknutí z UX průchodu (test-first: na kódu před opravou RED, po opravě GREEN).
 * Každý test = jedna oprava (nebo úzká skupina) s odkazem na nález z logs/r12/before/ux-results.json.
 *
 * Prostředí jako golden-path-r12-ux-walkthrough: lokální `next start` nad DB z `create.sh --local` (r12demo), simulátor
 * GoPay :3998. Testy si potřebná data zakládají samy (API / DB vlastníka), nespoléhají na pořadí průchodu.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const OWNER_URL = process.env.AUDIT_OWNER_URL ?? 'postgresql://neondb_owner:fixowner@localhost:55632/r12demo';
const OWNER = { email: 'demo@tixly-staging.test', pass: 'Demo2026!heslo' };
const RUN = Date.now().toString(36);
const PASS = 'Ux2026!heslo';
const RUN_IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;

test.describe.configure({ mode: 'default' }); // testy oprav jsou nezávislé — selhání jednoho nezastaví ostatní
test.use({ actionTimeout: 10_000, navigationTimeout: 20_000 });

let db: pg.Client;
const T = { promoterId: '', rBrno: '', rOstrava: '', box: `pokladna-fix-${RUN}@agentura.test`, gate: `vstup-fix-${RUN}@agentura.test` };
const q = async <R = Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<R[]> => (await db.query(sql, p)).rows as R[];
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

async function ctxFor(browser: Browser, mobile = false): Promise<{ ctx: BrowserContext; page: Page; dialogs: string[] }> {
  const ctx = await browser.newContext(mobile
    ? { baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { baseURL: BASE, viewport: { width: 1440, height: 900 } });
  await ctx.setExtraHTTPHeaders({ 'x-real-ip': RUN_IP });
  await ctx.addInitScript(() => { try { window.localStorage.setItem('tixly.cookie-consent', JSON.stringify({ essential: true, analytics: false, marketing: false, decidedAt: new Date().toISOString() })); } catch { /* */ } });
  const page = await ctx.newPage();
  const dialogs: string[] = [];
  page.on('dialog', (d) => { dialogs.push(`${d.type()}: ${d.message()}`); void d.dismiss(); });
  return { ctx, page, dialogs };
}
async function login(page: Page, email: string, pass: string): Promise<void> {
  const s = sessions.get(email);
  if (s) {
    await page.context().addCookies(s.cookies);
    const items = s.origins.find((o) => o.origin === new URL(BASE).origin)?.localStorage ?? [];
    await page.context().addInitScript((kv: Array<{ name: string; value: string }>) => { for (const { name, value } of kv) { try { window.localStorage.setItem(name, value); } catch { /* */ } } }, items);
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
async function token(page: Page): Promise<string> { return page.evaluate(() => localStorage.getItem('accessToken') ?? ''); }
async function api(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const t = await token(page);
  return page.evaluate(async ({ method, path, body, t }) => {
    const r = await fetch(path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> };
  }, { method, path, body, t });
}

test.beforeAll(async ({ playwright }) => {
  db = new pg.Client({ connectionString: OWNER_URL });
  await db.connect();
  T.promoterId = (await q<{ id: string }>(`SELECT p.id FROM platform.promoters p JOIN platform.promoter_members m ON m.promoter_id = p.id JOIN identity.users u ON u.id = m.user_id WHERE u.email = $1`, [OWNER.email]))[0].id;
  const terms = await q<{ id: string; title: string; city: string }>(`SELECT e.id, e.title, v.city FROM catalog.events e JOIN catalog.venues v ON v.id = e.venue_id WHERE e.promoter_id = $1 ORDER BY e.date_start`, [T.promoterId]);
  T.rBrno = terms.find((t) => t.title === 'Racek' && t.city === 'Brno')!.id;
  T.rOstrava = terms.find((t) => t.title === 'Racek' && t.city === 'Ostrava')!.id;
  const a = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-real-ip': RUN_IP } });
  for (const [email, role] of [[T.box, 'box_office'], [T.gate, 'staff']] as const) {
    const r = await a.post('/api/auth/register', { data: { email, password: PASS, name: 'Brigádník' }, headers: { origin: BASE } });
    expect(r.status(), await r.text()).toBe(200);
    await db.query(`INSERT INTO platform.promoter_members (promoter_id, user_id, role) SELECT $1, id, $2 FROM identity.users WHERE email = $3`, [T.promoterId, role, email]);
  }
  await a.dispose();
});
test.afterAll(async () => { await db?.end(); });

test.describe('vlastník', () => {
  let ctx: BrowserContext; let page: Page; let dialogs: string[];
  test.beforeAll(async ({ browser }) => { ({ ctx, page, dialogs } = await ctxFor(browser)); await login(page, OWNER.email, OWNER.pass); });
  test.afterAll(async () => { await ctx?.close(); });

  test('F1 navigace: Inscenace v menu, promo kódy z Marketingu, nástroje termínu přímo z karty inscenace', async () => {
    await page.goto('/admin');
    const nav = page.getByRole('navigation', { name: 'Hlavní navigace' });
    await expect(nav.getByRole('link', { name: 'Inscenace' })).toHaveAttribute('href', '/admin/productions');
    await page.goto('/admin/marketing');
    await expect(page.getByRole('link', { name: /Promo kódy/ }).first()).toBeVisible();
    await page.goto('/admin/productions/00000000-0000-4000-a000-000000000401');
    const row = page.getByTestId('term-row').filter({ hasText: 'Brno' }).first();
    for (const [label, slug] of [['Blokace', 'blokace'], ['Rezervace', 'rezervace'], ['Firemní', 'firemni'], ['Reporty', 'reporty'], ['Zrušení a přesun', 'zruseni']]) {
      await expect(row.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', `/admin/events/${T.rBrno}/${slug}`);
    }
  });

  test('F2 seznam akcí: město, zrušený termín „Zrušeno", česky', async () => {
    const cancelled = await q<{ id: string }>(`SELECT id FROM catalog.events WHERE promoter_id = $1 AND status = 'cancelled' LIMIT 1`, [T.promoterId]);
    if (!cancelled.length) {
      const h = (await q<{ id: string }>(`SELECT e.id FROM catalog.events e JOIN catalog.venues v ON v.id = e.venue_id WHERE e.promoter_id = $1 AND e.title = 'Hamlet' AND v.city = 'Ostrava'`, [T.promoterId]))[0].id;
      await db.query(`UPDATE catalog.events SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [h]);
    }
    await page.goto('/admin/events');
    const racek = page.locator('tbody tr').filter({ hasText: 'Racek' });
    await racek.first().waitFor();
    await expect(racek.filter({ hasText: 'Brno' })).toHaveCount(1);
    await expect(racek.filter({ hasText: 'Ostrava' })).toHaveCount(1);
    await expect(page.locator('tbody tr').filter({ hasText: 'Ostrava' }).filter({ hasText: 'Hamlet' })).toContainText('Zrušeno');
    const text = await page.locator('main').innerText();
    for (const en of ['Add-ons', 'Live', 'Member pricing', 'Dynamic', 'Hospitality', 'Klon']) expect(text, en).not.toMatch(new RegExp(`(^|\\s)${en}(\\s|$)`));
  });

  test('F3 blokace: bez volných míst se nezaloží prázdná; uvolnění s potvrzením; česky na plánku', async () => {
    const r = await api(page, 'POST', `/api/admin/events/${T.rBrno}/blocks`, { name: `Prázdná ${RUN}`, sector: 'Balkon' });
    expect(r.status).toBe(422);
    expect(String(r.json.message)).toMatch(/volná místa/);
    expect(await q(`SELECT 1 FROM catalog.seat_blocks WHERE event_id = $1 AND name = $2`, [T.rBrno, `Prázdná ${RUN}`])).toHaveLength(0);
    await page.goto(`/admin/events/${T.rBrno}/blokace`);
    await page.locator('svg[aria-label="Plánek s blokacemi"] circle').first().waitFor();
    const titles = await page.locator('svg[aria-label="Plánek s blokacemi"] title').allTextContents();
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.join('\n')).not.toMatch(/available|sold|blocked|held/);
    const before = await q<{ n: number }>(`SELECT COUNT(*)::int n FROM catalog.seat_block_seats bs JOIN catalog.seat_blocks b ON b.id = bs.block_id WHERE b.event_id = $1 AND bs.state = 'released'`, [T.rBrno]);
    await page.locator('[data-testid="blocks-table"] tr', { hasText: 'Tisk' }).first().getByRole('button', { name: 'Uvolnit vše' }).click();
    const dlg = page.getByTestId('confirm-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText(/vrátí .* do (volného )?prodeje/);
    await dlg.getByRole('button', { name: 'Zpět' }).click();
    await expect(dlg).toBeHidden();
    const after = await q<{ n: number }>(`SELECT COUNT(*)::int n FROM catalog.seat_block_seats bs JOIN catalog.seat_blocks b ON b.id = bs.block_id WHERE b.event_id = $1 AND bs.state = 'released'`, [T.rBrno]);
    expect(after[0].n).toBe(before[0].n);
    expect(dialogs.filter((d) => d.startsWith('confirm') || d.startsWith('prompt'))).toEqual([]);
  });

  test('F4 firemní objednávka: místa seřazená číselně, zaplacení a zrušení s potvrzením v okně aplikace (žádný prompt)', async () => {
    await page.goto(`/admin/events/${T.rBrno}/firemni`);
    const chips = page.getByTestId('corp-seat');
    await chips.first().waitFor();
    const first = await chips.evaluateAll((els) => els.slice(0, 3).map((e) => e.textContent?.trim()));
    expect(first).toEqual(['Přízemí 1/1', 'Přízemí 1/2', 'Přízemí 1/3']);
    // objednávka přes API (rychle), pak „Zaplaceno" v UI
    const seats = await q<{ id: string }>(`SELECT id FROM catalog.event_seats WHERE event_id = $1 AND status = 'available' AND sector = 'Přízemí' ORDER BY row::int DESC, seat_number::int LIMIT 2`, [T.rBrno]);
    const cat = (await q<{ id: string }>(`SELECT id FROM catalog.price_categories WHERE event_id = $1 AND code = 'plne'`, [T.rBrno]))[0].id;
    const cr = await api(page, 'POST', '/api/admin/corporate-orders', {
      eventId: T.rBrno, company: { name: `Firma Test ${RUN}`, ico: '12345679', dic: null, address: 'Brno' }, contact: { name: 'Jan', email: `fa-${RUN}@firma.test` },
      seats: seats.map((s) => ({ seatId: s.id, categoryId: cat })), dueDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
    });
    if (cr.status !== 201 && cr.status !== 200) throw new Error(`corporate-orders ${cr.status} ${JSON.stringify(cr.json)}`);
    await page.reload();
    const row = page.locator('[data-testid="corp-table"] tr', { hasText: `Firma Test ${RUN}` });
    await row.getByRole('button', { name: 'Zaplaceno' }).click();
    const dlg = page.getByTestId('confirm-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel(/Variabilní symbol/)).toBeVisible();
    await expect(dlg).toContainText(/vstupenky .* e-mail/i);
    await dlg.getByRole('button', { name: 'Zpět' }).click();
    await row.getByRole('button', { name: /Zrušit/ }).click();
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText(/faktur|dobropis|místa/i);
    await dlg.getByRole('button', { name: 'Zpět' }).click();
    expect(dialogs.filter((d) => d.startsWith('prompt') || d.startsWith('confirm'))).toEqual([]);
  });

  test('F5 přesun termínu: potvrzení s důsledky (e-mail kupcům)', async () => {
    await page.goto(`/admin/events/${T.rOstrava}/zruseni`);
    const when = new Date(Date.now() + 70 * 86_400_000).toISOString().slice(0, 10) + 'T19:00';
    await page.locator('input[type="datetime-local"]').first().fill(when);
    await page.getByPlaceholder('Důvod přesunu').fill('Test potvrzení');
    await page.getByRole('button', { name: /Přesunout a informovat kupce/ }).click();
    const dlg = page.getByTestId('confirm-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText(/e-mail/);
    await dlg.getByRole('button', { name: 'Zpět' }).click();
    const ev = await q<{ d: Date }>(`SELECT date_start AS d FROM catalog.events WHERE id = $1`, [T.rOstrava]);
    expect(new Date(ev[0].d).toISOString().slice(0, 10)).not.toBe(when.slice(0, 10));
  });

  test('F6 promo kód: potvrzení vytvoření, kategorie názvem, chyby česky', async () => {
    await page.goto('/admin/promo-codes');
    const code = `SEN${RUN.toUpperCase().slice(-5)}`;
    await page.getByPlaceholder('LETO2026').fill(code);
    await page.locator('form input[type="number"]').first().fill('15');
    const sel = page.getByLabel('Termín pro omezení');
    await sel.selectOption((await sel.locator('option').filter({ hasText: /Racek/ }).first().getAttribute('value'))!);
    await page.getByTestId('promo-restrictions').getByLabel(/Senior/).first().check();
    await page.getByRole('button', { name: /Vytvořit kód/ }).click();
    await expect(page.getByTestId('promo-msg')).toContainText(code);
    await expect(page.locator('tr', { hasText: code })).toContainText('Senior');
    await page.getByPlaceholder('LETO2026').fill(code);
    await page.locator('form input[type="number"]').first().fill('15');
    await page.getByRole('button', { name: /Vytvořit kód/ }).click();
    await expect(page.getByTestId('promo-msg')).toContainText(/už existuje/);
    expect(await page.locator('main').innerText()).not.toMatch(/CODE_ALREADY_EXISTS|Validation failed|checkout/);
  });

  test('F7 termín v sále bez míst v cenových zónách se nezaloží (dřív „v prodeji, 0 míst")', async () => {
    // sál, jehož plánek nemá místa přiřazená do zón
    const placeId = (await q<{ id: string }>(`INSERT INTO catalog.venue_places (promoter_id, name, city, address) VALUES ($1, $2, 'Zlín', 'nám. Míru 1') RETURNING id`, [T.promoterId, `Bez zón ${RUN}`]))[0].id;
    const venueId = (await q<{ id: string }>(`INSERT INTO catalog.venues (name, city, country, capacity, place_id) VALUES ($1, 'Zlín', 'CZ', 2, $2) RETURNING id`, [`Bez zón ${RUN} – Sál`, placeId]))[0].id;
    await db.query(`INSERT INTO catalog.venue_seating_charts (venue_id, name, total_seats, layout) VALUES ($1, 'Plánek', 2, $2)`,
      [venueId, JSON.stringify({ sectors: [{ name: 'Přízemí', rows: [{ label: '1', seats: [{ num: '1', x: 10, y: 10 }, { num: '2', x: 40, y: 10 }] }] }], zones: [{ id: 'za', name: 'Zóna A', color: '#dc2626' }] })]);
    const src = (await q<{ id: string }>(`SELECT id FROM catalog.events WHERE id = $1`, [T.rBrno]))[0].id;
    const r = await api(page, 'POST', '/api/admin/productions/00000000-0000-4000-a000-000000000401/terms', {
      venueId, copyPricingFromEventId: src, dateStart: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    });
    expect(r.status, JSON.stringify(r.json)).toBe(422);
    expect(String(r.json.message)).toMatch(/cenov/);
    expect(await q(`SELECT 1 FROM catalog.events WHERE venue_id = $1`, [venueId])).toHaveLength(0);
  });

  test('F8 editor plánku: česky, „Zpět" vede do knihovny míst', async () => {
    await page.goto('/admin/venues/00000000-0000-4000-a000-000000000201/seating-chart/editor');
    await expect(page.getByRole('heading', { name: 'Editor plánku sálu' })).toBeVisible();
    for (const b of ['Výběr', 'Posun', 'Vrátit', 'Znovu', 'Uložit plánek']) await expect(page.getByRole('button', { name: new RegExp(b) }).first()).toBeVisible();
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/Seating editor|\bSelect\b|\bUndo\b|\bRedo\b|Uložit layout|layout|Čísla seat|Default/);
    await expect(page.getByRole('link', { name: /Zpět/ }).first()).toHaveAttribute('href', '/admin/venues');
    await page.goto('/admin/venues');
    await expect(page.getByRole('link', { name: 'Plánek sedadel' })).toHaveCount(0);
  });

  test('F9 inscenace: fotka souborem, obsazení po řádcích; chyby česky', async () => {
    await page.goto('/admin/productions/00000000-0000-4000-a000-000000000402');
    await expect(page.locator('input[type="file"][accept*="image"]')).toHaveCount(1);
    await page.getByPlaceholder('Role (např. Hamlet)').last().fill('Ofélie');
    await page.getByPlaceholder('Jméno herce').last().fill(`Herečka ${RUN}`);
    await page.getByRole('button', { name: 'Přidat roli' }).click();
    await page.getByRole('button', { name: 'Uložit kartu' }).click();
    await expect(page.getByTestId('production-msg')).toContainText('uložena');
    const cast = (await q<{ c: Array<{ role: string; name: string }> }>(`SELECT cast_list AS c FROM catalog.productions WHERE id = '00000000-0000-4000-a000-000000000402'`))[0].c;
    expect(cast).toContainEqual({ role: 'Ofélie', name: `Herečka ${RUN}` });
    expect(await page.locator('main').innerText()).not.toMatch(/slug|INVALID_BODY|HTTP \d/);
  });
});

test.describe('pokladní a vstup', () => {
  test('F10 role pokladny: jen provozní menu; pokladna česky, s městem, odkaz na rezervace, tisk s QR', async ({ browser }) => {
    test.setTimeout(120_000);
    const { ctx, page } = await ctxFor(browser);
    await login(page, T.box, PASS);
    await page.goto('/admin');
    const labels = (await page.getByRole('navigation', { name: 'Hlavní navigace' }).getByRole('link').allTextContents()).map((s) => s.trim());
    for (const hidden of ['Finance', 'Tým', 'Nastavení', 'Marketing', 'Partneři', 'Sály']) expect(labels).not.toContain(hidden);
    for (const shown of ['Pokladna', 'Vstup', 'Akce']) expect(labels).toContain(shown);
    await page.goto('/admin/pos');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pokladna');
    const opts = await page.locator('#pos-event option').allTextContents();
    expect(opts.filter((o) => o.includes('Racek')).every((o) => /Brno|Ostrava|Olomouc|Zlín/.test(o))).toBe(true);
    expect(await page.locator('main').innerText()).not.toMatch(/POS|Walk-in|session/);
    await page.locator('#pos-event').selectOption(T.rBrno);
    await expect(page.getByRole('link', { name: /Rezervace k vyzvednutí/ })).toHaveAttribute('href', `/admin/events/${T.rBrno}/rezervace`);
    const ttSel = page.locator('#pos-tt');
    await ttSel.selectOption((await ttSel.locator('option').filter({ hasText: /Zóna A/ }).first().getAttribute('value'))!);
    await page.locator('button[title^="Přízemí"]').filter({ hasText: /^9$/ }).nth(2).click();
    await page.getByRole('button', { name: 'Vystavit vstupenku' }).click();
    const print = page.getByRole('link', { name: /Vytisknout vstupenky/ });
    await expect(print).toHaveAttribute('href', /\/api\/admin\/orders\/[0-9a-f-]{36}\/print-labels/);
    expect(await page.locator('main').innerText()).not.toMatch(/TOTP|secret/i);
    await ctx.close();
  });

  test('F11 vstup na mobilu: menu se schová, velké barevné stavy, zvuk a vibrace i u jiného termínu, výpadek sítě není zelený', async ({ browser }) => {
    test.setTimeout(120_000);
    const { ctx, page } = await ctxFor(browser, true);
    await login(page, T.gate, PASS);
    await page.goto('/admin');
    await expect(page.locator('aside')).toBeHidden();
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('navigation', { name: 'Hlavní navigace' }).getByRole('link', { name: 'Vstup' }).click();
    await page.waitForURL(/scanner/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kontrola vstupenek');
    await expect(page.getByLabel('Kód vstupenky')).toBeVisible();
    expect(await page.locator('main').innerText()).not.toMatch(/TOTP|payload|Ticket ID|Scanner/);
    await page.evaluate(() => {
      const w = window as unknown as { __vib: unknown[]; __snd: number[] };
      w.__vib = []; w.__snd = [];
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p: unknown) => { w.__vib.push(p); return true; } });
      const AC = window.AudioContext; const orig = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function (this: AudioContext) { const o = orig.call(this); setTimeout(() => w.__snd.push(Math.round(o.frequency.value)), 0); return o; };
    });
    const sel = page.locator('select').first();
    await sel.selectOption(T.rBrno);
    const done = page.getByRole('button', { name: /^Hotovo$/ });
    if (await done.isVisible().catch(() => false)) await done.click();
    // vstupenka jiného termínu (Racek Ostrava): koupená přes DB fixture? — vezmeme libovolnou platnou vstupenku jiného termínu
    const other = await q<{ id: string }>(`SELECT t.id FROM tickets.tickets t JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id WHERE tt.event_id <> $1 AND tt.event_id IN (SELECT id FROM catalog.events WHERE promoter_id = $2) AND t.status = 'valid' LIMIT 1`, [T.rBrno, T.promoterId]);
    test.skip(!other.length, 'v DB není platná vstupenka jiného termínu (spusťte nejdřív UX průchod)');
    await page.getByLabel('Kód vstupenky').fill(other[0].id);
    await page.getByRole('button', { name: 'Ověřit vstupenku' }).click();
    const state = page.getByTestId('scan-state');
    await expect(state).toHaveAttribute('data-tone', 'deny');
    await expect(state).toContainText('JINÝ TERMÍN');
    const fs = await state.evaluate((el) => parseFloat(getComputedStyle(el.querySelector('[data-testid="scan-headline"]')!).fontSize));
    expect(fs).toBeGreaterThanOrEqual(32);
    const w = await page.evaluate(() => { const x = window as unknown as { __vib: unknown[]; __snd: number[] }; return { __vib: x.__vib, __snd: x.__snd }; });
    expect(w.__vib.at(-1)).toEqual([200, 80, 200]);
    expect(w.__snd.length).toBeGreaterThan(0);
    // výpadek sítě bez staženého seznamu → oranžové „Ověřte ručně", ne zelené vpuštění
    await state.click(); // obsluha panel zavře klepnutím
    await expect(state).toBeHidden();
    await page.route('**/api/admin/scanner/validate', (r) => r.abort('internetdisconnected'));
    await page.getByLabel('Kód vstupenky').fill('11111111-2222-4333-8444-555555555555');
    await page.getByRole('button', { name: 'Ověřit vstupenku' }).click();
    await expect(state).toHaveAttribute('data-tone', 'warn');
    await expect(state).toContainText(/OVĚŘTE RUČNĚ|NENÍ OVĚŘENO/);
    await ctx.close();
  });
});

test.describe('kupec', () => {
  test('F12 web: odkaz Program v hlavičce, „Pokračovat k objednávce"', async ({ browser }) => {
    const { ctx, page } = await ctxFor(browser, true);
    await page.goto('/cs');
    const menuBtn = page.getByRole('button', { name: /Menu/ });
    if (await menuBtn.isVisible().catch(() => false)) await menuBtn.click();
    await expect(page.getByRole('link', { name: 'Program' }).first()).toHaveAttribute('href', /\/cs\/program/);
    await page.goto(`/cs/events/${T.rBrno}/seats`);
    await expect(page.getByRole('button', { name: /Pokračovat k objednávce/ })).toHaveCount(1);
    await ctx.close();
  });
});
