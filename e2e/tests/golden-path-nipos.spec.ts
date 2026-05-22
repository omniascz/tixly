/**
 * Golden Path: NIPOS reporting (CZ kulturní statistiky)
 *
 * NIPOS = Národní informační a poradenské středisko pro kulturu.
 * Tixly poskytuje agregaci pro výkaz Kult 1-01 (divadla) / V 5-01 (koncerty).
 *
 * Pokrytí:
 *   1) GET /api/admin/reports/nipos (default Q current) → JSON summary
 *   2) Custom range → JSON
 *   3) format=csv → CSV s ;-separated rows + Content-Disposition attachment
 *   4) invalid range (to<from) → 422
 *   5) bez auth → 401
 *   6) UI smoke: /admin/reports/nipos zobrazí summary + table
 */
import { test, expect, type BrowserContext } from '@playwright/test';

const PROMOTER_EMAIL = 'verze@divadlovceletne.cz';
const PROMOTER_PASSWORD = 'Demo2026!';

async function apiLogin(context: BrowserContext): Promise<string> {
  const r = await context.request.post('/api/auth/login', {
    data: { email: PROMOTER_EMAIL, password: PROMOTER_PASSWORD },
  });
  return ((await r.json()) as { accessToken: string }).accessToken;
}

test('NIPOS: default quarter → JSON summary s byCategory', async ({ context }) => {
  const token = await apiLogin(context);
  const r = await context.request.get('/api/admin/reports/nipos', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.status()).toBe(200);
  const body = (await r.json()) as {
    promoterId: string;
    promoterName: string;
    periodStart: string;
    periodEnd: string;
    totalEvents: number;
    totalVisitors: number;
    totalRevenueHalire: number;
    byCategory: Array<{ category: string; eventsPlanned: number }>;
  };
  expect(body.promoterId).toBeTruthy();
  expect(body.promoterName).toContain('Verze');
  expect(typeof body.totalEvents).toBe('number');
  expect(typeof body.totalRevenueHalire).toBe('number');
  expect(Array.isArray(body.byCategory)).toBe(true);
});

test('NIPOS: custom range → JSON', async ({ context }) => {
  const token = await apiLogin(context);
  const r = await context.request.get(
    '/api/admin/reports/nipos?from=2026-01-01&to=2026-12-31',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(r.status()).toBe(200);
  const body = (await r.json()) as { periodStart: string; periodEnd: string };
  expect(body.periodStart).toBe('2026-01-01');
  expect(body.periodEnd).toBe('2026-12-31');
});

test('NIPOS: format=csv → text/csv attachment', async ({ context }) => {
  const token = await apiLogin(context);
  const r = await context.request.get(
    '/api/admin/reports/nipos?from=2026-01-01&to=2026-12-31&format=csv',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toContain('text/csv');
  expect(r.headers()['content-disposition']).toContain('attachment');
  expect(r.headers()['content-disposition']).toContain('nipos-2026-01-01');
  const text = await r.text();
  expect(text).toContain('NIPOS Kult 1-01');
  expect(text).toContain('Pořadatel');
  expect(text).toContain('Kategorie;Plánováno;Odehráno');
});

test('NIPOS: invalid range to<from → 422', async ({ context }) => {
  const token = await apiLogin(context);
  const r = await context.request.get(
    '/api/admin/reports/nipos?from=2026-06-01&to=2026-01-01',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(r.status()).toBe(422);
  const body = (await r.json()) as { error: string };
  expect(body.error).toBe('INVALID_RANGE');
});

test('NIPOS: bez auth → 401', async ({ context }) => {
  const r = await context.request.get('/api/admin/reports/nipos');
  expect(r.status()).toBe(401);
});

test('NIPOS: UI page smoke', async ({ page, context }) => {
  const token = await apiLogin(context);
  await context.addInitScript((t: string) => {
    window.localStorage.setItem('accessToken', t);
  }, token);
  await context.addCookies([
    { name: 'accessToken', value: token, url: 'http://localhost:3000' },
  ]);

  await page.goto('/admin/reports/nipos', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: /NIPOS reporting/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId('nipos-from')).toBeVisible();
  await expect(page.getByTestId('nipos-to')).toBeVisible();
  await expect(page.getByTestId('nipos-refresh')).toBeVisible();
  await expect(page.getByTestId('nipos-download-csv')).toBeVisible();

  // Wait pro load() → summary cards
  await expect(page.getByTestId('nipos-total-events')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId('nipos-total-visitors')).toBeVisible();
  await expect(page.getByTestId('nipos-total-revenue')).toBeVisible();
});
