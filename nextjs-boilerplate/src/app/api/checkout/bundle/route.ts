/**
 * POST /api/checkout/bundle
 * Přidá parking nebo accommodation bundle ke stávající objednávce.
 * Volá se z checkout UI těsně před platbou.
 *
 * Body:
 *   orderId: string
 *   items: Array<{
 *     type: 'parking' | 'accommodation'
 *     offerId: string
 *     quantity?: number   (parking: počet míst, accommodation: default 1)
 *     nights?: number     (accommodation: počet nocí, default base_nights)
 *   }>
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

function genConfirmationCode(prefix: string): string {
  return `${prefix}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json() as {
    orderId: string;
    items: Array<{
      type: 'parking' | 'accommodation';
      offerId: string;
      quantity?: number;
      nights?: number;
    }>;
  };

  if (!body.orderId || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: 'orderId and items required' }, { status: 400 });
  }

  // Ověřit objednávku (status pending nebo created)
  const orderR = await runWithServiceContext(() =>
    db().query(
      `SELECT id, event_id, status FROM orders.orders WHERE id=$1 LIMIT 1`,
      [body.orderId],
    ),
  );
  if (orderR.rows.length === 0) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }
  const order = orderR.rows[0] as { id: string; event_id: string; status: string };
  if (!['pending', 'created', 'awaiting_payment'].includes(order.status)) {
    return NextResponse.json({ error: 'Order not in pending state' }, { status: 409 });
  }

  const insertedItems: object[] = [];
  let bundleTotalHalire = 0;

  for (const item of body.items) {
    if (item.type === 'parking') {
      // Atomický decrement + check kapacity
      const offerR = await runWithServiceContext(() =>
        db().query(
          `UPDATE catalog.parking_offers
           SET reserved_count = reserved_count + $1
           WHERE id=$2
             AND event_id=$3
             AND active=true
             AND (capacity=0 OR reserved_count + $1 <= capacity)
             AND (booking_deadline IS NULL OR booking_deadline > NOW())
           RETURNING id, name, price_halire, reserved_count, capacity, confirmation_prefix`,
          [item.quantity ?? 1, item.offerId, order.event_id],
        ),
      );
      if (offerR.rows.length === 0) {
        return NextResponse.json({
          error: 'Parking offer not available or fully booked',
          offerId: item.offerId,
        }, { status: 409 });
      }
      const offer = offerR.rows[0] as {
        id: string; name: string; price_halire: number;
        reserved_count: number; capacity: number; confirmation_prefix: string;
      };
      const qty = item.quantity ?? 1;
      const total = offer.price_halire * qty;
      bundleTotalHalire += total;

      const code = genConfirmationCode(offer.confirmation_prefix);
      const ins = await runWithServiceContext(() =>
        db().query(
          `INSERT INTO orders.bundle_items
             (order_id, item_type, parking_offer_id, quantity, unit_price_halire, total_price_halire, confirmation_code)
           VALUES ($1,'parking',$2,$3,$4,$5,$6)
           RETURNING id, confirmation_code`,
          [body.orderId, offer.id, qty, offer.price_halire, total, code],
        ),
      );
      insertedItems.push({
        id: ins.rows[0].id,
        type: 'parking',
        offerName: offer.name,
        quantity: qty,
        totalHalire: total,
        confirmationCode: ins.rows[0].confirmation_code,
      });

    } else if (item.type === 'accommodation') {
      const offerR = await runWithServiceContext(() =>
        db().query(
          `SELECT id, name, price_per_night_halire, base_nights
           FROM catalog.accommodation_offers
           WHERE id=$1 AND event_id=$2 AND active=true LIMIT 1`,
          [item.offerId, order.event_id],
        ),
      );
      if (offerR.rows.length === 0) {
        return NextResponse.json({ error: 'Accommodation offer not found', offerId: item.offerId }, { status: 404 });
      }
      const offer = offerR.rows[0] as {
        id: string; name: string; price_per_night_halire: number; base_nights: number;
      };
      const nights = item.nights ?? offer.base_nights;
      const total = offer.price_per_night_halire * nights;
      bundleTotalHalire += total;

      const code = genConfirmationCode('HTL');
      const ins = await runWithServiceContext(() =>
        db().query(
          `INSERT INTO orders.bundle_items
             (order_id, item_type, accommodation_offer_id, quantity, nights, unit_price_halire, total_price_halire, confirmation_code)
           VALUES ($1,'accommodation',$2,1,$3,$4,$5,$6)
           RETURNING id, confirmation_code`,
          [body.orderId, offer.id, nights, offer.price_per_night_halire, total, code],
        ),
      );
      insertedItems.push({
        id: ins.rows[0].id,
        type: 'accommodation',
        offerName: offer.name,
        nights,
        totalHalire: total,
        confirmationCode: ins.rows[0].confirmation_code,
      });
    }
  }

  // Přidat bundle cenu k objednávce
  if (bundleTotalHalire > 0) {
    await runWithServiceContext(() =>
      db().query(
        `UPDATE orders.orders
         SET total_amount = total_amount + $1, updated_at=NOW()
         WHERE id=$2`,
        [bundleTotalHalire, body.orderId],
      ),
    );
  }

  return NextResponse.json({ ok: true, items: insertedItems, bundleTotalHalire });
}
