/**
 * GET /api/buyer/orders/[orderId]/group-qr
 *
 * Vydá ČERSTVÝ group token (jeden QR za celou objednávku) vlastníkovi objednávky.
 * Lead osoba ho ukáže u dveří, scanner jím odbaví celou skupinu. App si ho
 * periodicky obnovuje (rotace proti screenshotu, TTL 60 s).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { signGroupToken } from '@/lib/safetix/group-token';

export async function GET(req: NextRequest, props: { params: Promise<{ orderId: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsUser(req, async (userId) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.orderId)) {
      return NextResponse.json({ error: 'INVALID_ID' }, { status: 422 });
    }
    // Vlastnictví + počet odbavitelných lístků.
    const o = await db().query<{ valid: string; total: string; event_title: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE t.status = 'valid')::text AS valid,
         COUNT(*)::text AS total,
         MAX(e.title) AS event_title
       FROM orders.orders ord
       JOIN tickets.tickets t ON t.order_id = ord.id
       JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
       JOIN catalog.events e ON e.id = tt.event_id
       WHERE ord.id = $1 AND ord.user_id = $2`,
      [params.orderId, userId],
    );
    if (o.rows.length === 0 || Number(o.rows[0].total) === 0) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 });
    }
    const { token, exp } = signGroupToken(params.orderId);
    return NextResponse.json({
      token,
      expiresAt: exp,
      eventTitle: o.rows[0].event_title,
      validCount: Number(o.rows[0].valid),
      totalCount: Number(o.rows[0].total),
      // app obnoví ~10 s před vypršením
      refreshInSeconds: 50,
    });
  });
}
