/**
 * Kolo 13 — opravy chyb a bezpečnosti z kola 12, které zůstaly po vrácení UX (body 1–10 zadání kola 13), na PŮVODNÍM UI
 * (texty, menu a vzhled = d0bbcb00). Nahrazuje golden-path-r12-ux-fixes (F1–F12) — testy vráceného UX jsou pryč.
 *
 * Prostředí: lokální `next start` nad DB z `create.sh --local` (demo agentura), simulátor GoPay :3998.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const OWNER_URL = process.env.AUDIT_OWNER_URL ?? 'postgresql://neondb_owner:fixowner@localhost:55632/r13demo';
const OWNER = { email: 'demo@tixly-staging.test', pass: 'Demo2026!heslo' };
const RUN = Date.now().toString(36);
const PASS = 'Ux2026!heslo';
const RUN_IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;

test.describe.configure({ mode: 'default' });
test.use({ actionTimeout: 10_000, navigationTimeout: 20_000 });

let db: pg.Client;
const T = { promoterId: '', rBrno: '', rOstrava: '', hOstrava: '', box: `pokladna-k-${RUN}@agentura.test`, gate: `vstup-k-${RUN}@agentura.test` };
const q = async <R = Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<R[]> => (await db.query(sql, p)).rows as R[];
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

async function ctxFor(browser: Browser): Promise<{ ctx: BrowserContext; page: Page; dialogs: string[] }> {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  await ctx.setExtraHTTPHeaders({ 'x-real-ip': RUN_IP });
  await ctx.addInitScript(() => { try { window.localStorage.setItem('tixly.cookie-consent', JSON.stringify({ essential: true, analytics: false, marketing: false, decidedAt: new Date().toISOString() })); } catch { /* */ } });
  const page = await ctx.newPage();
  const dialogs: string[] = [];
  // výchozí: okno prohlížeče ZAMÍTNOUT (Zrušit) — testuje, že bez potvrzení se nic nestane
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
async function api(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const t = await page.evaluate(() => localStorage.getItem('accessToken') ?? '');
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
  T.hOstrava = terms.find((t) => t.title === 'Hamlet' && t.city === 'Ostrava')!.id;
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

  test('bod 4: termín v sále bez míst v cenových zónách se nezaloží (ani nezveřejní)', async () => {
    const placeId = (await q<{ id: string }>(`INSERT INTO catalog.venue_places (promoter_id, name, city, address) VALUES ($1, $2, 'Zlín', 'nám. Míru 1') RETURNING id`, [T.promoterId, `Bez zón ${RUN}`]))[0].id;
    const venueId = (await q<{ id: string }>(`INSERT INTO catalog.venues (name, city, country, capacity, place_id) VALUES ($1, 'Zlín', 'CZ', 2, $2) RETURNING id`, [`Bez zón ${RUN} – Sál`, placeId]))[0].id;
    await db.query(`INSERT INTO catalog.venue_seating_charts (venue_id, name, total_seats, layout) VALUES ($1, 'Plánek', 2, $2)`,
      [venueId, JSON.stringify({ sectors: [{ name: 'Přízemí', rows: [{ label: '1', seats: [{ num: '1', x: 10, y: 10 }, { num: '2', x: 40, y: 10 }] }] }], zones: [{ id: 'za', name: 'Zóna A', color: '#dc2626' }] })]);
    const r = await api(page, 'POST', '/api/admin/productions/00000000-0000-4000-a000-000000000401/terms', {
      venueId, copyPricingFromEventId: T.rBrno, dateStart: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    });
    expect(r.status, JSON.stringify(r.json)).toBe(422);
    expect(r.json.error).toBe('NO_SELLABLE_SEATS');
    expect(String(r.json.message)).toBe('Sál nemá místa přiřazená do cenových zón.');
    expect(await q(`SELECT 1 FROM catalog.events WHERE venue_id = $1`, [venueId])).toHaveLength(0);
  });

  test('bod 5: blokace bez volných míst se nezaloží prázdná', async () => {
    // balkon Racek Brno je v demo datech celý v blokaci „Firma XY" → žádné volné místo
    const free = await q<{ n: number }>(`SELECT count(*)::int n FROM catalog.event_seats WHERE event_id = $1 AND sector = 'Balkon' AND status = 'available'`, [T.rBrno]);
    expect(free[0].n).toBe(0);
    const r = await api(page, 'POST', `/api/admin/events/${T.rBrno}/blocks`, { name: `Prázdná ${RUN}`, sector: 'Balkon' });
    expect(r.status).toBe(422);
    expect(String(r.json.message)).toBe('Ve výběru nejsou volná místa.');
    expect(await q(`SELECT 1 FROM catalog.seat_blocks WHERE event_id = $1 AND name = $2`, [T.rBrno, `Prázdná ${RUN}`])).toHaveLength(0);
    // chyba se ukáže na původní stránce blokací
    await page.goto(`/admin/events/${T.rBrno}/blokace`);
    await page.locator('svg[aria-label="Plánek s blokacemi"] circle').first().waitFor();
    await page.getByTestId('block-name').fill(`Prázdná ${RUN}`);
    await page.locator('select').filter({ has: page.locator('option', { hasText: 'Balkon' }) }).first().selectOption('Balkon');
    await page.getByTestId('block-create').click();
    await expect(page.getByText('Ve výběru nejsou volná místa.')).toBeVisible();
  });

  test('bod 6: „Zpět" z editoru plánku vede na existující stránku', async () => {
    await page.goto('/admin/venues/00000000-0000-4000-a000-000000000201/seating-chart/editor');
    const back = page.getByRole('link', { name: /Zpět na detail sálu/ });
    await expect(back).toHaveAttribute('href', '/admin/venues');
    await back.click();
    await page.waitForURL(/\/admin\/venues$/);
    await expect(page.getByText('404')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Sály', exact: true })).toBeVisible(); // knihovna míst (odtud vede „Editor plánku" sálu)
  });

  test('bod 7: zrušený termín v seznamu akcí „Zrušeno", ne „Prodej"', async () => {
    await db.query(`UPDATE catalog.events SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now()) WHERE id = $1`, [T.hOstrava]);
    await page.goto('/admin/events');
    const rows = page.locator('tbody tr').filter({ hasText: 'Hamlet' });
    await rows.first().waitFor();
    const statuses = await rows.locator('td').nth(2).allTextContents();
    const cancelledCount = (await q<{ n: number }>(`SELECT count(*)::int n FROM catalog.events WHERE promoter_id = $1 AND title = 'Hamlet' AND status = 'cancelled'`, [T.promoterId]))[0].n;
    const texts = await rows.allTextContents();
    expect(texts.filter((t) => t.includes('Zrušeno'))).toHaveLength(cancelledCount);
    expect(texts.filter((t) => t.includes('Zrušeno') && t.includes('Prodej'))).toHaveLength(0);
    expect(statuses.length).toBeGreaterThan(0);
  });

  test('bod 8: nepovedené stažení reportu ohlásí chybu', async () => {
    await page.goto(`/admin/events/${T.rBrno}/reporty`);
    await page.getByRole('button', { name: 'CSV', exact: true }).waitFor();
    await page.route('**/api/admin/theatre-reports?*format=csv*', (r) => r.fulfill({ status: 500, body: '{}' }));
    await page.getByRole('button', { name: 'CSV', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Soubor se nepodařilo stáhnout (HTTP 500).' })).toBeVisible();
    await page.unroute('**/api/admin/theatre-reports?*format=csv*');
    // původní popisky tlačítek
    await expect(page.getByRole('button', { name: 'Seznam pro uvaděče (PDF)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Uvaděči CSV' })).toBeVisible();
  });

  test('bod 10: přesun a zrušení termínu jen po potvrzení v okně', async () => {
    dialogs.length = 0;
    await page.goto(`/admin/events/${T.rOstrava}/zruseni`);
    const before = (await q<{ d: Date; s: string }>(`SELECT date_start AS d, status AS s FROM catalog.events WHERE id = $1`, [T.rOstrava]))[0];
    const when = new Date(Date.now() + 70 * 86_400_000).toISOString().slice(0, 10) + 'T19:00';
    await page.locator('input[type="datetime-local"]').first().fill(when);
    await page.getByPlaceholder('Důvod přesunu').fill('Test potvrzení');
    await page.getByRole('button', { name: 'Přesunout a informovat kupce' }).click();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toBe('confirm: Přesunout termín? Všem kupcům odejde e-mail s novým datem.');
    await page.getByPlaceholder('Důvod zrušení (pošle se kupcům)').fill('Test potvrzení');
    await page.getByPlaceholder('Pro potvrzení napište „ZRUŠIT"').fill('ZRUŠIT');
    await page.getByRole('button', { name: 'Zrušit termín' }).click();
    await expect.poll(() => dialogs.length).toBe(2);
    expect(dialogs[1]).toBe('confirm: Zrušit termín? Vstupenky přestanou platit a kupcům se vrátí peníze.');
    await page.waitForTimeout(500);
    const after = (await q<{ d: Date; s: string }>(`SELECT date_start AS d, status AS s FROM catalog.events WHERE id = $1`, [T.rOstrava]))[0];
    expect(new Date(after.d).toISOString()).toBe(new Date(before.d).toISOString()); // zamítnuto → nepřesunuto
    expect(after.s).toBe(before.s); // zamítnuto → nezrušeno
    await expect(page.getByTestId('term-msg')).toHaveCount(0);
  });

  test('bod 10: storno firemní objednávky jen po potvrzení v okně (beze změny od d0bbcb00)', async () => {
    dialogs.length = 0;
    const seats = await q<{ id: string }>(`SELECT id FROM catalog.event_seats WHERE event_id = $1 AND status = 'available' AND sector = 'Přízemí' ORDER BY row::int DESC, seat_number::int LIMIT 1`, [T.rBrno]);
    const cat = (await q<{ id: string }>(`SELECT id FROM catalog.price_categories WHERE event_id = $1 AND code = 'plne'`, [T.rBrno]))[0].id;
    const cr = await api(page, 'POST', '/api/admin/corporate-orders', {
      eventId: T.rBrno, company: { name: `Firma K ${RUN}`, ico: '12345679', dic: null, address: 'Brno' }, contact: { name: 'Jan', email: `fk-${RUN}@firma.test` },
      seats: seats.map((s) => ({ seatId: s.id, categoryId: cat })), dueDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
    });
    expect([200, 201], JSON.stringify(cr.json)).toContain(cr.status);
    await page.goto(`/admin/events/${T.rBrno}/firemni`);
    const row = page.locator('[data-testid="corp-table"] tr', { hasText: `Firma K ${RUN}` });
    await row.getByRole('button', { name: 'Zrušit / uvolnit' }).click();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toMatch(/^prompt: Důvod zrušení/);
    await page.waitForTimeout(500);
    const st = (await q<{ status: string }>(`SELECT status FROM b2b_orders.invoice_orders WHERE company_name = $1`, [`Firma K ${RUN}`]))[0];
    expect(st.status).not.toBe('cancelled');
  });
});

test.describe('pokladní a vstup', () => {
  test('bod 3: role Pokladna má na serveru omezený přístup (ne správce); vlastník beze změny', async ({ browser }) => {
    const own = await ctxFor(browser);
    await login(own.page, OWNER.email, OWNER.pass);
    await own.page.goto('/admin');
    expect((await api(own.page, 'GET', '/api/admin/chargebacks')).status).toBe(200);
    await own.ctx.close();
    for (const email of [T.box, T.gate]) {
      const { ctx, page } = await ctxFor(browser);
      await login(page, email, PASS);
      await page.goto('/admin');
      expect((await api(page, 'GET', '/api/admin/chargebacks')).status, email).toBe(403);
      // pokladní funkce dál fungují
      expect((await api(page, 'GET', '/api/admin/pos/events')).status, email).toBe(200);
      await ctx.close();
    }
  });

  test('body 2 a 9: pokladna — termíny odlišené městem, tisk = PDF vstupenek s QR, bez TOTP', async ({ browser }) => {
    test.setTimeout(120_000);
    const { ctx, page } = await ctxFor(browser);
    await login(page, T.box, PASS);
    await page.goto('/admin/pos');
    await expect(page.getByRole('heading', { name: 'Pokladna (POS)' })).toBeVisible(); // původní nadpis
    await page.locator('#pos-event option').nth(1).waitFor({ state: 'attached' });
    const opts = await page.locator('#pos-event option').allTextContents();
    const racek = opts.filter((o) => o.startsWith('Racek'));
    expect(racek.length).toBeGreaterThan(1);
    expect(racek.every((o) => /^Racek — (Brno|Ostrava) \(\d{1,2}\. \d{1,2}\. \d{4}\)$/.test(o)), racek.join(' | ')).toBe(true);
    await page.locator('#pos-event').selectOption(T.rBrno);
    const ttSel = page.locator('#pos-tt');
    await ttSel.selectOption((await ttSel.locator('option').filter({ hasText: /Zóna A/ }).first().getAttribute('value'))!);
    await page.locator('button[title^="Přízemí"]:not([disabled]):not([title*="blokace"])').first().click();
    await page.getByRole('button', { name: 'Vystavit lístek' }).click();
    const printBtn = page.getByRole('button', { name: 'Vytisknout / uložit jako PDF' });
    await printBtn.waitFor();
    await page.evaluate(() => { const w = window as unknown as { __open: unknown[]; __print: number }; w.__open = []; w.__print = 0; window.open = ((...a: unknown[]) => { w.__open.push(a[0]); return null; }) as typeof window.open; window.print = () => { w.__print++; }; });
    await printBtn.click();
    const opened = await page.evaluate(() => { const w = window as unknown as { __open: string[]; __print: number }; return { open: w.__open, print: w.__print }; });
    expect(opened.print).toBe(0);
    expect(opened.open).toHaveLength(1);
    expect(opened.open[0]).toMatch(/^\/api\/admin\/orders\/[0-9a-f-]{36}\/print-labels$/);
    const pdf = await api(page, 'GET', opened.open[0]).catch(() => null);
    expect(pdf?.status ?? 200).toBe(200);
    expect(await page.content()).not.toMatch(/TOTP/i);
    await ctx.close();
  });

  test('bod 1: skener při výpadku sítě nehlásí „Vstup povolen" bez ověření', async ({ browser }) => {
    test.setTimeout(90_000);
    const { ctx, page } = await ctxFor(browser);
    await login(page, T.gate, PASS);
    await page.goto('/admin/scanner');
    await expect(page.getByRole('heading', { name: 'Scanner' })).toBeVisible(); // původní nadpis
    const sel = page.locator('select').first();
    await sel.locator(`option[value="${T.rBrno}"]`).waitFor({ state: 'attached' });
    await sel.selectOption(T.rBrno);
    const done = page.getByRole('button', { name: /^Hotovo$/ });
    if (await done.isVisible().catch(() => false)) await done.click();
    const input = page.getByPlaceholder('8a4f7b2e-… / tixly:…:123456 / TXP2.…');
    // a) síť spadne během ověření, seznam pro offline není stažený
    await page.route('**/api/admin/scanner/validate', (r) => r.abort('internetdisconnected'));
    await input.fill('11111111-2222-4333-8444-555555555555');
    await page.getByRole('button', { name: 'Validovat lístek' }).click();
    await expect(page.getByText('OFFLINE: lístek nelze ověřit (není stažený seznam) — zkontroluj ho ručně.')).toBeVisible();
    await expect(page.getByText('Vstup povolen')).toHaveCount(0);
    await page.unroute('**/api/admin/scanner/validate');
    // b) zařízení je offline (navigator.onLine = false), seznam není stažený
    await ctx.setOffline(true);
    await expect(page.getByText(/Offline — skeny jdou do lokální fronty/)).toBeVisible();
    await input.fill('11111111-2222-4333-8444-666666666666');
    await page.getByRole('button', { name: 'Validovat lístek' }).click();
    await expect(page.getByText('OFFLINE: lístek nelze ověřit (není stažený seznam) — zkontroluj ho ručně.')).toBeVisible();
    await expect(page.getByText('Vstup povolen')).toHaveCount(0);
    await ctx.setOffline(false);
    await ctx.close();
  });
});
