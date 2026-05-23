/**
 * Golden Path: Dynamic pricing skutečně mění checkout total (P1.6 fix).
 *
 * Předchozí golden-path-dynamic-pricing.spec.ts ověřoval jen že cron
 * vrátí {processed, updated, failed} shape, ale NIKDY nekoupil ticket
 * a neověřil že buyer skutečně zaplatí uplifted price. Engine počítal
 * `dynamic_price_minor` do sloupce co resolve-price.ts vůbec nečetl.
 *
 * Po fix: resolve-price.ts má novou top-priority branch pro
 * dynamic_price_minor (pokud non-null a > 0).
 *
 * Test:
 *  1. Najdi GA event + ticket_type
 *  2. Set dynamic_price_minor v DB na 2× base_price
 *  3. Checkout → totalAmount = dynamic_price × quantity
 *  4. Cleanup: NULL dynamic_price_minor
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import { Pool } from 'pg';

const ADMIN_EMAIL = 'admin@tixly.cz';

async function login(
  context: BrowserContext,
  email: string,
): Promise<{ accessToken: string; userId: string }> {
  const r = await context.request.post('/api/auth/login', {
    data: { email, password: 'Demo2026!' },
  });
  if (r.status() !== 200) throw new Error(`Login failed: ${email}`);
  const body = (await r.json()) as { accessToken: string; user: { id: string } };
  return { accessToken: body.accessToken, userId: body.user.id };
}

async function getUsableEvent(
  context: BrowserContext,
  admin: { accessToken: string },
): Promise<{ eventId: string; ticketTypeId: string; basePrice: number }> {
  const r = await context.request.get('/api/admin/events', {
    headers: { Authorization: `Bearer ${admin.accessToken}` },
  });
  const body = (await r.json()) as
    | Array<{ id: string; moderationStatus?: string }>
    | { events?: Array<{ id: string; moderationStatus?: string }> };
  const events = Array.isArray(body) ? body : (body.events ?? []);
  for (const ev of events) {
    if (ev.moderationStatus && ev.moderationStatus !== 'published') continue;
    const tt = await context.request.get(`/api/events/${ev.id}/ticket-types`);
    if (!tt.ok()) continue;
    const ttBody = (await tt.json()) as {
      ticketTypes: Array<{
        id: string;
        remainingQty: number;
        basePrice: number;
        isSeated: boolean;
      }>;
    };
    const usable = ttBody.ticketTypes.find(
      (t) => !t.isSeated && t.remainingQty > 0 && t.basePrice > 0,
    );
    if (usable)
      return {
        eventId: ev.id,
        ticketTypeId: usable.id,
        basePrice: usable.basePrice,
      };
  }
  throw new Error('No usable GA event');
}

test.describe.serial('Dynamic pricing', () => {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://tixly:tixly_dev@localhost:5433/tixly',
  });
  let ticketTypeId = '';
  let basePrice = 0;

  test.afterAll(async () => {
    if (ticketTypeId) {
      await pool.query(
        `UPDATE catalog.ticket_types
            SET dynamic_price_minor = NULL,
                dynamic_price_signals = NULL,
                dynamic_price_updated_at = NULL
          WHERE id = $1`,
        [ticketTypeId],
      );
    }
    await pool.end();
  });

  test('Dynamic price je opravdu charged v checkoutu', async ({ context }) => {
    const admin = await login(context, ADMIN_EMAIL);
    const ev = await getUsableEvent(context, admin);
    ticketTypeId = ev.ticketTypeId;
    basePrice = ev.basePrice;

    // Set dynamic price na 2× base (např. base=300 Kč → dynamic=600 Kč)
    const dynamicPrice = basePrice * 2;
    await pool.query(
      `UPDATE catalog.ticket_types
          SET dynamic_price_minor = $2,
              dynamic_price_signals = '{"test": "uplifted_2x"}'::jsonb,
              dynamic_price_updated_at = NOW()
        WHERE id = $1`,
      [ticketTypeId, dynamicPrice],
    );

    // Reset resolve-price cache — kolega-test mohl naběhnout před tím než
    // dynamic_price_minor sloupec existoval. V dev mode TX nemá restart,
    // ale po fix migrace 324 by tabulka měla existovat → cache je správně.
    // Pokud test pad nedeterministicky, restartni dev server.

    const co = await context.request.post('/api/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        eventId: ev.eventId,
        ticketTypeId,
        quantity: 1,
        buyerEmail: `dyn-${Date.now()}@example.cz`,
        buyerName: 'Dynamic Test',
        paymentMethod: 'gopay',
      },
    });
    expect(co.status()).toBe(200);
    const body = (await co.json()) as {
      orderId: string;
      subtotalAmount: number;
      totalAmount: number;
    };
    // KRITICKÝ ASSERT — buyer zaplatil dynamickou cenu, ne base.
    expect(body.subtotalAmount).toBe(dynamicPrice);
    expect(body.totalAmount).toBeGreaterThanOrEqual(dynamicPrice);

    // Verify DB — order.total_amount má dynamickou cenu
    const dbCheck = await pool.query<{ total_amount: number }>(
      `SELECT total_amount FROM orders.orders WHERE id = $1`,
      [body.orderId],
    );
    expect(dbCheck.rows[0].total_amount).toBeGreaterThanOrEqual(dynamicPrice);
  });

  test('Bez dynamic price → fallback na base_price', async ({ context }) => {
    // Cleanup dynamic price na predchozim ticket_type
    if (ticketTypeId) {
      await pool.query(
        `UPDATE catalog.ticket_types SET dynamic_price_minor = NULL WHERE id = $1`,
        [ticketTypeId],
      );
    }

    const admin = await login(context, ADMIN_EMAIL);
    const ev = await getUsableEvent(context, admin);

    const co = await context.request.post('/api/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        eventId: ev.eventId,
        ticketTypeId: ev.ticketTypeId,
        quantity: 1,
        buyerEmail: `nodyn-${Date.now()}@example.cz`,
        buyerName: 'Base Price Test',
        paymentMethod: 'gopay',
      },
    });
    expect(co.status()).toBe(200);
    const body = (await co.json()) as { subtotalAmount: number };
    expect(body.subtotalAmount).toBe(ev.basePrice);
  });
});
