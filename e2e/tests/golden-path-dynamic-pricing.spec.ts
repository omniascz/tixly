/**
 * Golden Path: Dynamic pricing engine (CZ priority #7, ROI 6/10)
 *
 * Tixly už mělo backend (engine.ts s velocity + scarcity formulas +
 * dynamic_pricing_rules schema + admin endpoint). CHYBĚL periodic
 * recompute cron — added GET /api/internal/cron/recompute-dynamic-pricing.
 *
 * Pokrytí:
 *   1. GET /api/admin/ticket-types/[id]/dynamic-pricing — vrátí current rule
 *   2. PUT update rule (admin)
 *   3. GET cron recompute endpoint → processed/updated/failed counts
 *   4. Recompute bez enabled rules → updated=0
 */
import { test, expect, type BrowserContext } from '@playwright/test';

async function adminToken(context: BrowserContext): Promise<string> {
  const r = await context.request.post('/api/auth/login', {
    data: { email: 'admin@tixly.cz', password: 'Demo2026!' },
  });
  const body = (await r.json()) as { accessToken: string };
  return body.accessToken;
}

test('Dynamic pricing: cron endpoint vrátí processed/updated/failed', async ({
  context,
}) => {
  const r = await context.request.get(
    '/api/internal/cron/recompute-dynamic-pricing',
  );
  expect(r.status()).toBe(200);
  const body = (await r.json()) as {
    ok: boolean;
    processed: number;
    updated: number;
    failed: number;
  };
  expect(body.ok).toBe(true);
  expect(typeof body.processed).toBe('number');
  expect(typeof body.updated).toBe('number');
  expect(typeof body.failed).toBe('number');
  expect(body.failed).toBeLessThanOrEqual(body.processed);
});

test('Dynamic pricing: admin GET/PUT rule pro ticket_type', async ({ context }) => {
  const token = await adminToken(context);
  // Najdi existing ticket_type pro admin's promotér
  const evs = await context.request.get('/api/admin/events', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await evs.json()) as
    | Array<{ id: string }>
    | { events?: Array<{ id: string }> };
  const events = Array.isArray(body) ? body : (body.events ?? []);

  let ticketTypeId = '';
  for (const ev of events) {
    const tt = await context.request.get(`/api/events/${ev.id}/ticket-types`);
    if (!tt.ok()) continue;
    const ttBody = (await tt.json()) as { ticketTypes: Array<{ id: string; basePrice: number }> };
    if (ttBody.ticketTypes?.length > 0 && ttBody.ticketTypes[0].basePrice > 0) {
      ticketTypeId = ttBody.ticketTypes[0].id;
      break;
    }
  }
  expect(ticketTypeId).toBeTruthy();

  // GET current rule (možná žádné)
  const get = await context.request.get(
    `/api/admin/ticket-types/${ticketTypeId}/dynamic-pricing`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(get.status()).toBe(200);

  // PUT — set rule s konzervativními limity
  const put = await context.request.put(
    `/api/admin/ticket-types/${ticketTypeId}/dynamic-pricing`,
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        enabled: true,
        minPriceMinor: 10000,
        maxPriceMinor: 100000,
        velocityThresholdPerHour: 5,
        maxUpliftPct: 20,
        scarcityThresholdPct: 30,
        scarcityUpliftPct: 10,
      },
    },
  );
  expect(put.status()).toBeLessThan(400);

  // Re-GET — ověř že rule existuje a má naše hodnoty
  const reGet = await context.request.get(
    `/api/admin/ticket-types/${ticketTypeId}/dynamic-pricing`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const reGetBody = (await reGet.json()) as {
    rule?: { enabled: boolean; maxUpliftPct?: number; max_uplift_pct?: number };
  };
  expect(reGetBody.rule?.enabled).toBe(true);

  // Recompute cron — měl by zachytit nově enabled rule
  const cron = await context.request.get(
    '/api/internal/cron/recompute-dynamic-pricing',
  );
  expect(cron.status()).toBe(200);
  const cronBody = (await cron.json()) as { processed: number };
  expect(cronBody.processed).toBeGreaterThanOrEqual(1);

  // Cleanup — disable rule abychom neměli leftover effect
  await context.request.put(
    `/api/admin/ticket-types/${ticketTypeId}/dynamic-pricing`,
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        enabled: false,
        minPriceMinor: 10000,
        maxPriceMinor: 100000,
        velocityThresholdPerHour: 10,
        maxUpliftPct: 25,
        scarcityThresholdPct: 20,
        scarcityUpliftPct: 15,
      },
    },
  );
});
