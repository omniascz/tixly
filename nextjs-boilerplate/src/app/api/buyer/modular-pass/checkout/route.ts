/**
 * POST /api/buyer/modular-pass/checkout
 *
 * Buyer dokončí "build your own pass" formulář, posílá:
 *   { eventId, ticketTypeId, selections: [{ dayId, zoneId }], buyerEmail, buyerName, paymentMethod }
 *
 * Server:
 *   1. Validuje že ticket_type má modular_pricing config
 *   2. Validuje min/max days a min/max zones limity
 *   3. Spočítá cenu = base + days_count × per_day + zones_count × per_zone
 *   4. Vytvoří order + ticket
 *   5. Pre-populate tickets.ticket_modular_access pro vybranou matrix
 *   6. Delegate to payment provider (gopay default)
 *
 * Po payment scanner enforce → tickets.ticket_modular_access fallthrough
 * (viz scanner/validate route).
 */
import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { createPayment } from '@/lib/payment/provider';
import { saleBlockedResponse } from '@/lib/sales/cutoff';


const schema = z.object({
  eventId: z.string().uuid(),
  ticketTypeId: z.string().uuid(),
  selections: z
    .array(z.object({ dayId: z.string().uuid(), zoneId: z.string().uuid() }))
    .min(1)
    .max(100),
  buyerEmail: z.string().email().max(200),
  buyerName: z.string().min(2).max(120),
  paymentMethod: z
    .enum(['gopay', 'wero', 'przelewy24', 'bank_transfer'])
    .default('gopay'),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_BODY', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;
  // Kolo 7 (C-29): po uzávěrce online prodeje nový nákup nejde.
  const salesClosed = await saleBlockedResponse(db(), input.eventId, 'online');
  if (salesClosed) return salesClosed;

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Kolo 3: servisní kontext (runWithServiceContext) stačí — politiky mají větev app_is_service(); admin eskalace odstraněna.

    // 1) Validate ticket_type + modular config + event published
    const tt = await client.query<{
      id: string;
      event_id: string;
      base_price: number;
      per_day_price_minor: number;
      per_zone_surcharge_minor: number;
      min_days: number;
      max_days: number | null;
      min_zones: number;
      max_zones: number | null;
      currency: string;
      event_title: string;
    }>(
      `SELECT tt.id, tt.event_id, tt.base_price,
              mp.per_day_price_minor, mp.per_zone_surcharge_minor,
              mp.min_days, mp.max_days, mp.min_zones, mp.max_zones,
              e.currency, e.title AS event_title
         FROM catalog.ticket_types tt
         JOIN catalog.ticket_modular_pricing mp ON mp.ticket_type_id = tt.id
         JOIN catalog.events e ON e.id = tt.event_id
        WHERE tt.id = $1 AND tt.event_id = $2 AND e.status = 'published'`,
      [input.ticketTypeId, input.eventId],
    );
    if (tt.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'NO_MODULAR_PASS' },
        { status: 404 },
      );
    }
    const config = tt.rows[0];

    // 2) Validate (day_id, zone_id) tuples belong to event
    const dayIds = [...new Set(input.selections.map((s) => s.dayId))];
    const zoneIds = [...new Set(input.selections.map((s) => s.zoneId))];

    const validDays = await client.query<{ id: string }>(
      `SELECT id FROM catalog.event_days WHERE event_id = $1 AND id = ANY($2::uuid[])`,
      [input.eventId, dayIds],
    );
    if (validDays.rows.length !== dayIds.length) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'INVALID_DAY_IDS' },
        { status: 422 },
      );
    }
    const validZones = await client.query<{ id: string }>(
      `SELECT id FROM catalog.event_zones WHERE event_id = $1 AND id = ANY($2::uuid[])`,
      [input.eventId, zoneIds],
    );
    if (validZones.rows.length !== zoneIds.length) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'INVALID_ZONE_IDS' },
        { status: 422 },
      );
    }

    // 3) Enforce min/max limity (count unique days a unique zones)
    if (dayIds.length < config.min_days) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'TOO_FEW_DAYS', minDays: config.min_days },
        { status: 422 },
      );
    }
    if (config.max_days !== null && dayIds.length > config.max_days) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'TOO_MANY_DAYS', maxDays: config.max_days },
        { status: 422 },
      );
    }
    if (zoneIds.length < config.min_zones) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'TOO_FEW_ZONES', minZones: config.min_zones },
        { status: 422 },
      );
    }
    if (config.max_zones !== null && zoneIds.length > config.max_zones) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'TOO_MANY_ZONES', maxZones: config.max_zones },
        { status: 422 },
      );
    }

    // 4) Compute total = base + days × per_day + zones × per_zone
    const totalAmount =
      config.base_price +
      dayIds.length * config.per_day_price_minor +
      zoneIds.length * config.per_zone_surcharge_minor;

    // 5) Resolve / create guest user
    const u = await client.query<{ id: string }>(
      `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, created_at, updated_at)
       VALUES ($1, $2, '!guest', NOW(), NOW(), NOW())
       ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [input.buyerEmail.toLowerCase(), input.buyerName],
    );
    const userId = u.rows[0].id;

    // 6) Kapacita: modular pass = 1 vstupenka; dřív se neodečítala → přeprodej nad kapacitu.
    const cap = await client.query(
      `UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - 1
        WHERE id = $1 AND remaining_qty > 0 RETURNING id`,
      [input.ticketTypeId],
    );
    if (cap.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'SOLD_OUT' }, { status: 409 });
    }

    // 7) Platba PŘED zápisem objednávky (jako party-split a white-label): výjimka brány → ROLLBACK, nic nezůstane.
    //    Dřív se createPayment nevolal vůbec a kupec šel vždy na /mock-gopay (v produkci 403).
    const orderId = randomUUID();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const payment = await createPayment({
      orderId,
      amountHalire: totalAmount,
      currency: config.currency,
      buyerEmail: input.buyerEmail.toLowerCase(),
      buyerName: input.buyerName,
      description: `Modulární pas: ${config.event_title}`,
      paymentMethod: input.paymentMethod,
      appUrl,
    });
    const REAL_GATEWAYS = ['comgate', 'stripe', 'mollie', 'paypal', 'przelewy24'];
    const storedProvider = REAL_GATEWAYS.includes(payment.provider) ? payment.provider : input.paymentMethod;

    await client.query(
      `INSERT INTO orders.orders
         (id, user_id, event_id, status, total_amount, currency, locale,
          gopay_payment_id, payment_provider, idempotency_key,
          expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'pending', $4, $5, 'cs',
               $6, $7, $8,
               NOW() + INTERVAL '15 minutes', NOW(), NOW())`,
      [
        orderId,
        userId,
        input.eventId,
        totalAmount,
        config.currency,
        payment.paymentId,
        storedProvider,
        randomUUID(),
      ],
    );

    // 7) order_items
    await client.query(
      `INSERT INTO orders.order_items
         (order_id, ticket_type_id, quantity, unit_price, total_price)
       VALUES ($1, $2, 1, $3, $3)`,
      [orderId, input.ticketTypeId, totalAmount],
    );

    // Výběr dní×zón ve STEJNÉ transakci: dřív se ukládal zvlášť a chyba se jen zalogovala →
    // vstupenka bez omezení = skener pustil všude (fallback na výchozí přístup typu).
    await client.query(
      `INSERT INTO marketing.modular_pass_pending_selections (order_id, selections)
       VALUES ($1, $2::jsonb)`,
      [orderId, JSON.stringify(input.selections)],
    );

    await client.query('COMMIT');

    return NextResponse.json({
      orderId,
      paymentId: payment.paymentId,
      gatewayUrl: payment.gatewayUrl,
      provider: storedProvider,
      totalAmount,
      daysCount: dayIds.length,
      zonesCount: zoneIds.length,
      pricing: {
        base: config.base_price,
        perDay: config.per_day_price_minor,
        perZone: config.per_zone_surcharge_minor,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[POST /api/buyer/modular-pass/checkout]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
