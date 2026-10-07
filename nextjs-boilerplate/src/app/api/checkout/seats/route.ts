/**
 * POST /api/checkout/seats — nákup konkrétních míst se slevovou kategorií u každého místa (kolo 8 / krok 4).
 *
 * Body: { eventId, seatHoldToken, items: [{ seatId, categoryId }], buyerEmail, buyerName, buyerPhone?, promoCode?,
 *         paymentMethod?: 'gopay' | 'box_office_reservation' }
 * 'box_office_reservation' (kolo 8 / krok 5) = „Rezervovat, zaplatím na pokladně": stejná místa, kategorie a cena,
 * ale bez brány — objednávka pending do lhůty vyzvednutí (lib/theatre/reservations.ts), e-mail s kódem rezervace.
 * Cena se počítá VŽDY na serveru (lib/theatre/categories.ts): kategorie × zóna místa, pravidla doprovodu ZTP/P
 * a limity kategorií; promo kód z ceny kategorie (lib/theatre/promo.ts); servisní poplatek pořadatele.
 * Sdílené kontroly jako u /api/checkout: uzávěrka prodeje + DPH (saleBlockedResponse), politika bran
 * (gateway-policy), limity vytváření objednávek (order-creation-limits). Místa musí být podržená tímto
 * holdTokenem (POST /api/events/[id]/seats/hold). Běží v servisním kontextu jako /api/checkout (existující vzor).
 */
import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withDbOverload } from '@/lib/db/overload';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { resolveServiceFee } from '@/lib/fees/service-fee';
import { createOrGetGuestUser } from '@/lib/identity/guest-user';
import { internalAuthHeaders } from '@/lib/internal-auth';
import { enforceOrderCreationLimits } from '@/lib/orders/order-creation-limits';
import { effectiveGateway, gatewayNotAllowedResponse } from '@/lib/payment/gateway-policy';
import { saleBlockedResponse } from '@/lib/sales/cutoff';
import { CategoryRuleError, priceSeats } from '@/lib/theatre/categories';
import { applyPromo, PromoError } from '@/lib/theatre/promo';
import { assertReservable, checkReservationLimits, insertReservation, ReservationError, sendReservationMail } from '@/lib/theatre/reservations';

export const dynamic = 'force-dynamic';

const schema = z.object({
  eventId: z.string().uuid(),
  seatHoldToken: z.string().uuid(),
  items: z.array(z.object({ seatId: z.string().uuid(), categoryId: z.string().uuid() })).min(1).max(10),
  buyerEmail: z.string().email().max(320),
  buyerName: z.string().trim().min(1).max(200),
  buyerPhone: z.string().max(40).optional(),
  promoCode: z.string().trim().min(1).max(40).optional(),
  paymentMethod: z.enum(['gopay', 'box_office_reservation']).default('gopay'),
});

// Kolo 14: vyčerpaný pool DB při náporu → řízené 503 Retry-After (lib/db/overload)
export async function POST(req: NextRequest): Promise<Response> {
  return withDbOverload(() => postCheckoutSeats(req));
}

async function postCheckoutSeats(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'VALIDATION_FAILED', issues: parsed.error.issues }, { status: 422 });
    const input = parsed.data;
    if (new Set(input.items.map((i) => i.seatId)).size !== input.items.length) {
      return NextResponse.json({ error: 'DUPLICATE_SEAT' }, { status: 422 });
    }

    const blocked = await saleBlockedResponse(db(), input.eventId, 'online');
    if (blocked) return blocked;
    const ev = (await db().query<{
      promoter_id: string; currency: string; title: string; date_start: Date;
      reservations_enabled: boolean; reservation_days: number; reservation_cutoff_hours: number;
    }>(
      `SELECT promoter_id, currency, title, date_start, reservations_enabled, reservation_days, reservation_cutoff_hours
         FROM catalog.events WHERE id = $1 AND status = 'published'`, [input.eventId],
    )).rows[0];
    if (!ev) return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
    const reserve = input.paymentMethod === 'box_office_reservation';
    let reservationUntil: Date | null = null;
    if (reserve) {
      try {
        reservationUntil = assertReservable(ev);
      } catch (err) {
        if (err instanceof ReservationError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
        throw err;
      }
      // sdílený rate limit: zakládání rezervací z jedné IP (vedle limitů objednávek níže)
      const { checkRateLimit, rateLimitResponse } = await import('@/lib/rate-limit/per-tenant');
      const { clientIp } = await import('@/lib/security/client-ip');
      const rl = rateLimitResponse(await checkRateLimit(`seat-reservation:ip:${clientIp(req)}`, { limit: 5, windowMs: 60 * 60 * 1000 }), 'rezervace');
      if (rl) return rl;
    } else {
      const gw = await gatewayNotAllowedResponse(db(), input.eventId, effectiveGateway('gopay', ev.currency));
      if (gw) return gw;
    }
    const limited = await enforceOrderCreationLimits(req, { email: input.buyerEmail });
    if (limited) return limited;

    const userId = await createOrGetGuestUser(db(), { email: input.buyerEmail, name: input.buyerName });

    const orderId = randomUUID();
    const paymentPlaceholder = `seats-pay-${randomUUID().slice(0, 8)}`;
    let total = 0;
    let priced: Awaited<ReturnType<typeof priceSeats>> = [];
    let reservation: { id: string; code: string; cancelToken: string } | null = null;
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const seats = (await client.query<{ id: string; ticket_type_id: string }>(
        `SELECT id, ticket_type_id FROM catalog.event_seats
          WHERE event_id = $1 AND id = ANY($2::uuid[]) AND status = 'held' AND notes = $3 AND hold_until > now()
          ORDER BY id FOR UPDATE`,
        [input.eventId, input.items.map((i) => i.seatId), input.seatHoldToken],
      )).rows;
      if (seats.length !== input.items.length) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'SEAT_HOLD_INVALID', message: 'Vybraná místa už nejsou podržená — vyberte je prosím znovu.' },
          { status: 409 },
        );
      }

      if (reserve) await checkReservationLimits(client, input.eventId, input.buyerEmail, input.items.length);
      priced = await priceSeats(client, input.eventId, seats, input.items);
      let discountBySeat = new Map<string, number>();
      let promoCodeId: string | null = null;
      if (input.promoCode) {
        const p = await applyPromo(client, { code: input.promoCode, eventId: input.eventId, promoterId: ev.promoter_id, userId, seats: priced });
        discountBySeat = p.discountBySeat;
        promoCodeId = p.promoCodeId;
      }
      const subtotal = priced.reduce((a, s) => a + s.priceMinor - (discountBySeat.get(s.seatId) ?? 0), 0);
      const discount = [...discountBySeat.values()].reduce((a, b) => a + b, 0);
      const fee = (await resolveServiceFee(client, { promoterId: ev.promoter_id, currency: ev.currency, quantity: priced.length })).totalFeeMinor;
      total = subtotal + fee;

      await client.query(
        `INSERT INTO orders.orders
           (id, user_id, event_id, status, total_amount, currency, locale, gopay_payment_id, payment_provider, idempotency_key,
            discount_halire, promo_code_id, service_fee_minor, buyer_phone, expires_at, order_source, created_at, updated_at)
         VALUES ($1, $2, $3, 'pending', $4, $5, 'cs', $6, $7, $8, $9, $10, $11, $12, COALESCE($13, now() + interval '15 minutes'), $14, now(), now())`,
        [orderId, userId, input.eventId, total, ev.currency, reserve ? null : paymentPlaceholder, reserve ? 'box_office' : input.paymentMethod,
          randomUUID(), discount, promoCodeId, fee, input.buyerPhone ?? null, reservationUntil, reserve ? 'seat_reservation' : 'web'],
      );
      for (const s of priced) {
        const net = s.priceMinor - (discountBySeat.get(s.seatId) ?? 0);
        await client.query(
          `INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price, seat_id, price_category_id, price_category_name)
           VALUES ($1, $2, 1, $3, $3, $4, $5, $6)`,
          [orderId, s.ticketTypeId, net, s.seatId, s.categoryId, s.categoryName],
        );
      }
      await client.query(
        `UPDATE catalog.event_seats SET status = 'sold', order_id = $2, hold_until = NULL, updated_at = now() WHERE id = ANY($1::uuid[])`,
        [priced.map((s) => s.seatId), orderId],
      );
      const perType = new Map<string, number>();
      for (const s of priced) perType.set(s.ticketTypeId, (perType.get(s.ticketTypeId) ?? 0) + 1);
      for (const [tt, n] of perType) {
        await client.query(`UPDATE catalog.ticket_types SET remaining_qty = GREATEST(0, remaining_qty - $2) WHERE id = $1`, [tt, n]);
      }
      if (promoCodeId) {
        await client.query(
          `INSERT INTO marketing.promo_code_usages (promo_code_id, order_id, user_id, discount_halire) VALUES ($1, $2, $3, $4)`,
          [promoCodeId, orderId, userId, discount],
        );
      }
      if (reserve && reservationUntil) {
        reservation = await insertReservation(client, {
          orderId, eventId: input.eventId, promoterId: ev.promoter_id, email: input.buyerEmail, name: input.buyerName,
          phone: input.buyerPhone ?? null, seatCount: priced.length, expiresAt: reservationUntil,
        });
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (err instanceof CategoryRuleError || err instanceof PromoError || err instanceof ReservationError) {
        return NextResponse.json({ error: err.code, message: err.message }, { status: 422 });
      }
      throw err;
    } finally {
      client.release();
    }

    if (reservation && reservationUntil) {
      const r = { order_id: orderId, code: reservation.code, buyer_email: input.buyerEmail, buyer_name: input.buyerName, expires_at: reservationUntil };
      await sendReservationMail(db(), 'created', r, reservation.cancelToken).catch((e: unknown) => console.error('[checkout/seats] reservation mail failed', e));
      return NextResponse.json({
        orderId, reservationCode: reservation.code, expiresAt: reservationUntil.toISOString(), totalAmount: total,
        items: priced.map((s) => ({ seatId: s.seatId, category: s.categoryName, priceMinor: s.priceMinor })),
      });
    }

    // Platba (po commitu, jako /api/checkout). Bezplatná objednávka (vše zdarma) se dokončí bez brány.
    const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    if (total === 0) {
      await db().query(`UPDATE orders.orders SET status = 'paid', paid_at = now(), payment_provider = 'free' WHERE id = $1`, [orderId]);
      // vstupenky + e-mail stejnou cestou jako po platbě (gopay webhook → internal/order-completed in-process)
      const { POST: completeOrder } = await import('@/app/api/internal/order-completed/route');
      const done = await completeOrder(new NextRequest(`${appUrl}/api/internal/order-completed`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...internalAuthHeaders() }, body: JSON.stringify({ orderId }),
      }));
      if (!done.ok) console.error('[checkout/seats] order-completed failed', orderId, done.status);
      return NextResponse.json({ orderId, totalAmount: 0, provider: 'free', gatewayUrl: `${appUrl}/cs/order-confirmation/${orderId}` });
    }
    const { createPayment } = await import('@/lib/payment/provider');
    const session = await createPayment({
      orderId, amountHalire: total, currency: ev.currency, buyerEmail: input.buyerEmail, buyerName: input.buyerName,
      description: `${ev.title} × ${priced.length}`, paymentMethod: 'gopay', appUrl,
    });
    const REAL = ['gopay', 'comgate', 'stripe', 'mollie', 'paypal', 'przelewy24'];
    await db().query(
      `UPDATE orders.orders SET gopay_payment_id = $2, payment_provider = CASE WHEN $3 = ANY($4::text[]) THEN $3 ELSE payment_provider END, updated_at = now()
        WHERE id = $1`,
      [orderId, session.paymentId, session.provider, REAL],
    );
    return NextResponse.json({
      orderId, paymentId: session.paymentId, gatewayUrl: session.gatewayUrl, provider: session.provider, totalAmount: total,
      items: priced.map((s) => ({ seatId: s.seatId, category: s.categoryName, priceMinor: s.priceMinor })),
    });
  });
}
