/**
 * Kolo 16 / krok 1 — hodnoty napsané do formuláře PŘED dokončením hydratace se nesmí ztratit.
 *
 * Každý formulář: kontext v pomalé síti (CDP Network.emulateNetworkConditions), první pole se vyplní hned po načtení
 * HTML — ještě před hydratací (ověřeno: element nemá React fiber) —, další pole až po hydrataci (to vyvolá nové
 * vykreslení řízených polí), pak odeslání. Kontrola: odeslaný požadavek obsahuje napsané hodnoty a akce projde.
 *
 * Formuláře: přihlášení (administrace / vlastník, pokladna, skener, kupec), prodejce, B2B, registrace kupce,
 * registrace pořadatele, zapomenuté heslo, nové heslo, checkout, vyhledávání rezervací na pokladně, pole skeneru.
 * Prostředí: next start nad DB z create.sh --local (logs/r16/reset_demo.sh), Mailpit :58225.
 */
import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type Request } from '@playwright/test';
import pg from 'pg';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const OWNER_URL = process.env.AUDIT_OWNER_URL ?? 'postgresql://neondb_owner:fixowner@localhost:55632/r16demo';
const MAILPIT = process.env.MAILPIT ?? 'http://localhost:58225';
const OWNER = { email: 'demo@tixly-staging.test', pass: 'Demo2026!heslo' };
const RBRNO = '00000000-0000-4000-a000-000000000501';
const RUN = Date.now().toString(36);
const PASS = 'Hydratace2026!x';
const U = {
  box: `r16-pokladna-${RUN}@test.cz`, gate: `r16-sken-${RUN}@test.cz`, buyer: `r16-kupec-${RUN}@test.cz`,
  reseller: `r16-prodejce-${RUN}@test.cz`, regBuyer: `r16-reg-${RUN}@test.cz`, regPromoter: `r16-regpro-${RUN}@test.cz`,
};
// pomalá síť: JS se stahuje několik sekund → první pole se vyplní před hydratací
const SLOW = { offline: false, latency: 250, downloadThroughput: 150 * 1024, uploadThroughput: 150 * 1024 };

let db: pg.Client;
const q = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, p)).rows;
const ipFor = (): string => `10.${16 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

async function slowPage(browser: Browser, mobile = false): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(mobile
    ? { baseURL: BASE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { baseURL: BASE, viewport: { width: 1440, height: 900 } });
  await ctx.setExtraHTTPHeaders({ 'x-real-ip': ipFor() });
  await ctx.addInitScript(() => { try { window.localStorage.setItem('tixly.cookie-consent', JSON.stringify({ essential: true, analytics: false, marketing: false, decidedAt: '2026-10-08T00:00:00.000Z' })); } catch { /* */ } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => void d.dismiss());
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', SLOW);
  return { ctx, page };
}
const hydrated = (l: Locator): Promise<boolean> => l.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactFiber')));
/** Vyplní pole hned po načtení HTML; vrátí, zda to bylo před hydratací (jinak test neměří, co má). */
async function typeBeforeHydration(page: Page, field: Locator, value: string): Promise<void> {
  await field.waitFor({ state: 'attached', timeout: 60_000 });
  const before = !(await hydrated(field));
  await field.pressSequentially(value, { delay: 0 });
  expect(before, 'pole se mělo vyplnit před hydratací (pomalá síť nestačila)').toBe(true);
}
async function waitHydrated(field: Locator): Promise<void> {
  await expect.poll(() => hydrated(field), { timeout: 90_000, intervals: [250] }).toBe(true);
  await field.page().waitForTimeout(300); // efekty po hydrataci
}
const bodyOf = (r: Request): Record<string, unknown> => JSON.parse(r.postData() ?? '{}') as Record<string, unknown>;

async function loginFlow(browser: Browser, email: string, pass: string, expectUrl: RegExp): Promise<void> {
  const { ctx, page } = await slowPage(browser);
  await page.goto('/cs/login', { waitUntil: 'commit' });
  const emailField = page.locator('input[type="email"]').first();
  await typeBeforeHydration(page, emailField, email);
  await waitHydrated(emailField);
  await page.getByLabel('Heslo').fill(pass);
  await expect(emailField, 'e-mail napsaný před hydratací zůstal i po vyplnění hesla').toHaveValue(email);
  const [req, res] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith('/api/auth/login') && r.method() === 'POST', { timeout: 60_000 }),
    page.waitForResponse((r) => r.url().endsWith('/api/auth/login'), { timeout: 60_000 }),
    page.getByRole('button', { name: /^Přihlásit$/ }).click(),
  ]);
  expect(bodyOf(req).email, 'odeslaný e-mail').toBe(email);
  expect(res.status(), await res.text()).toBe(200);
  await page.waitForURL(expectUrl, { timeout: 60_000 });
  await ctx.close();
}

test.beforeAll(async ({ playwright }) => {
  db = new pg.Client({ connectionString: OWNER_URL });
  await db.connect();
  const promoterId = (await q<{ id: string }>(`SELECT p.id FROM platform.promoters p JOIN platform.promoter_members m ON m.promoter_id = p.id JOIN identity.users u ON u.id = m.user_id WHERE u.email = $1`, [OWNER.email]))[0].id;
  const a = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-real-ip': ipFor() } });
  for (const email of [U.box, U.gate, U.buyer]) {
    const r = await a.post('/api/auth/register', { data: { email, password: PASS, name: 'Hydratace Test' }, headers: { origin: BASE } });
    expect(r.status(), await r.text()).toBe(200);
  }
  await a.dispose();
  for (const [email, role] of [[U.box, 'box_office'], [U.gate, 'staff']] as const) {
    await db.query(`INSERT INTO platform.promoter_members (promoter_id, user_id, role) SELECT $1, id, $2 FROM identity.users WHERE email = $3`, [promoterId, role, email]);
  }
  // prodejce s heslem — bcrypt hash z pgcrypto (crypt + gen_salt('bf'), kompatibilní s bcryptjs v /api/admin/resellers)
  await db.query(
    `INSERT INTO platform.reseller_partners (name, contact_email, commission_pct, password_hash, status)
     VALUES ('Hydratace prodejce', $1, 5, public.crypt($2, public.gen_salt('bf', 10)), 'active')`,
    [U.reseller, PASS],
  );
});
test.afterAll(async () => { await db?.end(); });

test('přihlášení — administrace (vlastník)', async ({ browser }) => {
  test.setTimeout(240_000);
  await loginFlow(browser, OWNER.email, OWNER.pass, /\/admin/);
});
test('přihlášení — pokladna (role Pokladna)', async ({ browser }) => {
  test.setTimeout(240_000);
  await loginFlow(browser, U.box, PASS, /\/admin/);
});
test('přihlášení — skener (role personál)', async ({ browser }) => {
  test.setTimeout(240_000);
  await loginFlow(browser, U.gate, PASS, /\/admin/);
});
test('přihlášení — kupec', async ({ browser }) => {
  test.setTimeout(240_000);
  await loginFlow(browser, U.buyer, PASS, /\/cs\/events/);
});

test('přihlášení — prodejce', async ({ browser }) => {
  test.setTimeout(240_000);
  const { ctx, page } = await slowPage(browser);
  await page.goto('/reseller/login', { waitUntil: 'commit' });
  const emailField = page.locator('#email');
  await typeBeforeHydration(page, emailField, U.reseller);
  await waitHydrated(emailField);
  await page.locator('#password').fill(PASS);
  const [req, res] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith('/api/reseller/auth') && r.method() === 'POST', { timeout: 60_000 }),
    page.waitForResponse((r) => r.url().endsWith('/api/reseller/auth'), { timeout: 60_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
  expect(bodyOf(req).email).toBe(U.reseller);
  expect(res.status(), await res.text()).toBe(200);
  await page.waitForURL(/\/reseller\/dashboard/, { timeout: 60_000 });
  await ctx.close();
});

test('přihlášení — B2B (pozvánkový kód)', async ({ browser }) => {
  test.setTimeout(240_000);
  const acc = (await q<{ id: string }>(`INSERT INTO platform.b2b_accounts (company_name, ico, contact_email) VALUES ('Hydratace s.r.o.', '12345678', $1) RETURNING id`, [`b2b-${RUN}@test.cz`]))[0].id;
  const token = (await q<{ invite_token: string }>(`INSERT INTO platform.b2b_account_users (account_id, email, name, invited_at) VALUES ($1, $2, 'Firemní nákupčí', now()) RETURNING invite_token`, [acc, `b2b-user-${RUN}@test.cz`]))[0].invite_token;
  const { ctx, page } = await slowPage(browser);
  await page.goto('/b2b/login', { waitUntil: 'commit' });
  const field = page.locator('#b2b-invite-token');
  await typeBeforeHydration(page, field, token);
  await waitHydrated(field);
  const [req, res] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith('/api/b2b/account/login') && r.method() === 'POST', { timeout: 60_000 }),
    page.waitForResponse((r) => r.url().endsWith('/api/b2b/account/login'), { timeout: 60_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
  expect(bodyOf(req).inviteToken).toBe(token);
  expect(res.status(), await res.text()).toBe(200);
  await ctx.close();
});

test('registrace kupce', async ({ browser }) => {
  test.setTimeout(240_000);
  const { ctx, page } = await slowPage(browser);
  await page.goto('/cs/register', { waitUntil: 'commit' });
  await typeBeforeHydration(page, page.locator('#register-name'), 'Rychlý Kupec');
  await typeBeforeHydration(page, page.locator('#register-email'), U.regBuyer);
  await waitHydrated(page.locator('#register-email'));
  await page.locator('#register-password').fill(PASS);
  for (const cb of await page.locator('input[type="checkbox"]').all()) if (!(await cb.isChecked())) await cb.check();
  const [req, res] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith('/api/auth/register') && r.method() === 'POST', { timeout: 60_000 }),
    page.waitForResponse((r) => r.url().endsWith('/api/auth/register'), { timeout: 60_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
  expect(bodyOf(req)).toMatchObject({ email: U.regBuyer, name: 'Rychlý Kupec' });
  expect(res.status(), await res.text()).toBe(200);
  await ctx.close();
});

test('registrace pořadatele', async ({ browser }) => {
  test.setTimeout(240_000);
  const { ctx, page } = await slowPage(browser);
  await page.goto('/cs/register-promoter', { waitUntil: 'commit' });
  await typeBeforeHydration(page, page.locator('#promoter-email'), U.regPromoter);
  await waitHydrated(page.locator('#promoter-email'));
  await page.locator('#promoter-password').fill(PASS);
  await page.locator('#promoter-password-confirm').fill(PASS);
  const req = page.waitForRequest((r) => r.url().endsWith('/api/auth/register-promoter') && r.method() === 'POST', { timeout: 60_000 });
  for (const cb of await page.locator('input[type="checkbox"]').all()) if (!(await cb.isChecked())) await cb.check();
  await page.locator('button[type="submit"]').first().click();
  expect(bodyOf(await req).email).toBe(U.regPromoter);
  await ctx.close();
});

test('zapomenuté heslo a nové heslo (odkaz z e-mailu)', async ({ browser }) => {
  test.setTimeout(300_000);
  const { ctx, page } = await slowPage(browser);
  await page.goto('/cs/forgot-password', { waitUntil: 'commit' });
  const fp = page.locator('#fp-email');
  await typeBeforeHydration(page, fp, U.buyer);
  await waitHydrated(fp);
  const [req, res] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith('/api/auth/forgot-password') && r.method() === 'POST', { timeout: 60_000 }),
    page.waitForResponse((r) => r.url().endsWith('/api/auth/forgot-password'), { timeout: 60_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
  expect(bodyOf(req).email).toBe(U.buyer);
  expect(res.status()).toBeLessThan(400);
  // odkaz z e-mailu (Mailpit)
  let link = '';
  await expect.poll(async () => {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${U.buyer}`)}`)).json() as { messages?: Array<{ ID: string }> };
    for (const m of list.messages ?? []) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json() as { Text?: string; HTML?: string };
      const hit = `${msg.Text ?? ''} ${msg.HTML ?? ''}`.match(/https?:\/\/[^\s"'<>]+reset-password\?token=[^\s"'<>&]+/);
      if (hit) { link = hit[0]; return true; }
    }
    return false;
  }, { timeout: 60_000 }).toBe(true);
  await ctx.close();
  const token = new URL(link).searchParams.get('token') ?? '';
  const { ctx: ctx2, page: p2 } = await slowPage(browser);
  await p2.goto(`/cs/reset-password?token=${encodeURIComponent(token)}`, { waitUntil: 'commit' });
  await typeBeforeHydration(p2, p2.locator('#rp-pw'), `${PASS}N`);
  await waitHydrated(p2.locator('#rp-pw'));
  await p2.locator('#rp-pw2').fill(`${PASS}N`);
  const [req2, res2] = await Promise.all([
    p2.waitForRequest((r) => r.url().endsWith('/api/auth/reset-password') && r.method() === 'POST', { timeout: 60_000 }),
    p2.waitForResponse((r) => r.url().endsWith('/api/auth/reset-password'), { timeout: 60_000 }),
    p2.locator('button[type="submit"]').click(),
  ]);
  expect(JSON.stringify(bodyOf(req2))).toContain(`${PASS}N`);
  expect(res2.status(), await res2.text()).toBe(200);
  await ctx2.close();
});

test('checkout — jméno napsané před hydratací se odešle', async ({ browser }) => {
  test.setTimeout(240_000);
  const tt = (await q<{ id: string }>(`SELECT id FROM catalog.ticket_types WHERE event_id = $1 ORDER BY name, id LIMIT 1`, [RBRNO]))[0].id;
  const { ctx, page } = await slowPage(browser, true);
  await page.goto(`/cs/checkout?eventId=${RBRNO}&ticketTypeId=${tt}&quantity=1`, { waitUntil: 'commit' });
  const name = page.locator('#checkout-name');
  await typeBeforeHydration(page, name, 'Rychlá Kupující');
  await waitHydrated(name);
  await page.locator('#checkout-email').fill(`r16-checkout-${RUN}@test.cz`);
  const req = page.waitForRequest((r) => r.url().endsWith('/api/checkout') && r.method() === 'POST', { timeout: 60_000 });
  await page.getByRole('button', { name: /Pokračovat na platbu/ }).click();
  expect(bodyOf(await req)).toMatchObject({ buyerName: 'Rychlá Kupující', buyerEmail: `r16-checkout-${RUN}@test.cz` });
  await ctx.close();
});

test.describe('pokladna a skener (přihlášený vlastník)', () => {
  let state: Awaited<ReturnType<BrowserContext['storageState']>>;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: BASE });
    await ctx.setExtraHTTPHeaders({ 'x-real-ip': ipFor() });
    const page = await ctx.newPage();
    await page.goto('/cs/login', { waitUntil: 'networkidle' });
    await page.getByLabel('E-mail').fill(OWNER.email);
    await page.getByLabel('Heslo').fill(OWNER.pass);
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/auth/login')), page.getByRole('button', { name: /^Přihlásit$/ }).click()]);
    await page.waitForURL(/\/admin/);
    state = await ctx.storageState();
    await ctx.close();
  });
  const authedSlow = async (browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> => {
    const { ctx, page } = await slowPage(browser);
    await ctx.addCookies(state.cookies);
    await ctx.addInitScript((ls) => { for (const { name, value } of ls) { try { window.localStorage.setItem(name, value); } catch { /* */ } } }, state.origins.flatMap((o) => o.localStorage));
    return { ctx, page };
  };

  test('vyhledávání rezervací na pokladně', async ({ browser }) => {
    test.setTimeout(240_000);
    const { ctx, page } = await authedSlow(browser);
    await page.goto(`/admin/events/${RBRNO}/rezervace`, { waitUntil: 'commit' });
    const search = page.getByPlaceholder('Kód, jméno, e-mail nebo telefon');
    await typeBeforeHydration(page, search, 'NOVAK');
    await waitHydrated(search);
    const req = page.waitForRequest((r) => r.url().includes('/api/admin/seat-reservations?') && r.url().includes('q='), { timeout: 60_000 });
    await search.press('Enter');
    expect(new URL((await req).url()).searchParams.get('q')).toBe('NOVAK');
    await ctx.close();
  });

  test('pole skeneru', async ({ browser }) => {
    test.setTimeout(240_000);
    const { ctx, page } = await authedSlow(browser);
    await page.goto('/admin/scanner', { waitUntil: 'commit' });
    const input = page.getByTestId('scanner-ticket-input');
    const id = '8a4f7b2e-0000-4000-a000-000000000001';
    await typeBeforeHydration(page, input, id);
    await waitHydrated(input);
    await expect(input).toHaveValue(id);
    await page.getByPlaceholder('123456').fill('111111'); // jiné pole po hydrataci → nové vykreslení
    await expect(input, 'kód napsaný před hydratací zůstal').toHaveValue(id);
    await ctx.close();
  });
});
