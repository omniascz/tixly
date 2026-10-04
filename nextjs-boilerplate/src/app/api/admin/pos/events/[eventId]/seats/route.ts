/**
 * GET /api/admin/pos/events/[eventId]/seats — místa termínu pro pokladnu (kolo 8 / krok 3): stav, typ vstupenky,
 * typ místa a u blokovaných název blokace (pokladna je vidí blokovaná s názvem; prodat z blokace jde s blockId).
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { eventId: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.eventId)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const own = await db().query(`SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`, [params.eventId, promoter.promoterId]);
    if (own.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const r = await db().query(
      `SELECT es.id, es.sector, es.row, es.seat_number AS "seatNumber", es.x_coord AS x, es.y_coord AS y, es.status,
              es.ticket_type_id AS "ticketTypeId", es.seat_type AS "seatType", es.price_zone AS "priceZone",
              CASE WHEN es.hold_kind = 'block' THEN es.hold_label END AS "blockName",
              (SELECT bs.block_id FROM catalog.seat_block_seats bs WHERE bs.seat_id = es.id AND bs.state = 'blocked' LIMIT 1) AS "blockId"
         FROM catalog.event_seats es
        WHERE es.event_id = $1
        ORDER BY es.sector, es.row, es.seat_number`,
      [params.eventId],
    );
    return NextResponse.json({ seats: r.rows });
  });
}
