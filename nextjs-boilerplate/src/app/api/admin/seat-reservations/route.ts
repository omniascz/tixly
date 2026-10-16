/**
 * GET /api/admin/seat-reservations?q=…&eventId=… — pokladna hledá rezervaci podle kódu, jména, e-mailu nebo telefonu
 * (kolo 8 / krok 5). Jen rezervace termínů aktivního pořadatele (RLS + promoter_id).
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const url = new URL(req.url);
    const q = (url.searchParams.get('q') ?? '').trim();
    const eventId = url.searchParams.get('eventId');
    if (q.length < 2) return NextResponse.json({ error: 'QUERY_TOO_SHORT' }, { status: 422 });
    if (eventId && !/^[0-9a-f-]{36}$/i.test(eventId)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const digits = q.replace(/\D/g, '');
    const rows = (await db().query(
      `SELECT r.id, r.code, r.event_id AS "eventId", e.title AS "eventTitle", e.date_start AS "eventStart",
              r.buyer_name AS "buyerName", r.buyer_email AS "buyerEmail", r.buyer_phone AS "buyerPhone",
              r.seat_count AS "seatCount", r.status, r.expires_at AS "expiresAt", o.total_amount AS "totalMinor", o.currency,
              (SELECT json_agg(json_build_object('sector', es.sector, 'row', es.row, 'seat', es.seat_number, 'category', oi.price_category_name)
                        ORDER BY es.sector, es.row, es.seat_number)
                 FROM orders.order_items oi JOIN catalog.event_seats es ON es.id = oi.seat_id WHERE oi.order_id = r.order_id) AS seats
         FROM orders.seat_reservations r
         JOIN orders.orders o ON o.id = r.order_id
         JOIN catalog.events e ON e.id = r.event_id
        WHERE r.promoter_id = $1 AND ($2::uuid IS NULL OR r.event_id = $2)
          AND (r.code = upper($3) OR r.buyer_email ILIKE '%' || $3 || '%' OR r.buyer_name ILIKE '%' || $3 || '%'
               OR ($4 <> '' AND regexp_replace(COALESCE(r.buyer_phone, ''), '[^0-9]', '', 'g') LIKE '%' || $4 || '%'))
        ORDER BY (r.status = 'active') DESC, r.expires_at
        LIMIT 50`,
      [promoter.promoterId, eventId, q, digits.length >= 6 ? digits : ''],
    )).rows;
    return NextResponse.json({ reservations: rows });
  });
}
