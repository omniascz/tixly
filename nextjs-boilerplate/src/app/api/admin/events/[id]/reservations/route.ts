/**
 * Rezervace termínu s platbou na pokladně (kolo 8 / krok 5).
 *   GET   — nastavení, seznam rezervací a obsazenost: prodáno vs. rezervováno (rezervace se počítají do obsazenosti,
 *           ale vykazují se zvlášť), propadlé / zrušené
 *   PATCH — { enabled, days?, cutoffHours? } — povolit rezervace, lhůta N dní od vytvoření, nejpozději M hodin před začátkem
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;
const schema = z.object({
  enabled: z.boolean(),
  days: z.number().int().min(1).max(60).optional(),
  cutoffHours: z.number().int().min(0).max(336).optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const ev = (await db().query<{ reservations_enabled: boolean; reservation_days: number; reservation_cutoff_hours: number }>(
      `SELECT reservations_enabled, reservation_days, reservation_cutoff_hours FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    )).rows[0];
    if (!ev) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const reservations = (await db().query<{ status: string }>(
      `SELECT r.id, r.code, r.buyer_name AS "buyerName", r.buyer_email AS "buyerEmail", r.buyer_phone AS "buyerPhone",
              r.seat_count AS "seatCount", r.status, r.expires_at AS "expiresAt", r.paid_at AS "paidAt", r.payment_type AS "paymentType",
              o.total_amount AS "totalMinor"
         FROM orders.seat_reservations r JOIN orders.orders o ON o.id = r.order_id
        WHERE r.event_id = $1 ORDER BY r.created_at DESC`,
      [params.id],
    )).rows;
    const occ = (await db().query<{ capacity: number; sold: number; reserved: number; blocked: number }>(
      `SELECT COUNT(*)::int AS capacity,
              COUNT(*) FILTER (WHERE es.status = 'sold' AND NOT EXISTS (
                SELECT 1 FROM orders.seat_reservations r WHERE r.order_id = es.order_id AND r.status = 'active'))::int AS sold,
              COUNT(*) FILTER (WHERE es.status = 'sold' AND EXISTS (
                SELECT 1 FROM orders.seat_reservations r WHERE r.order_id = es.order_id AND r.status = 'active'))::int AS reserved,
              COUNT(*) FILTER (WHERE es.status = 'blocked')::int AS blocked
         FROM catalog.event_seats es WHERE es.event_id = $1`,
      [params.id],
    )).rows[0];
    const counts = Object.fromEntries(['active', 'paid', 'expired', 'cancelled'].map((s) => [s, reservations.filter((r) => r.status === s).length]));
    return NextResponse.json({
      settings: { enabled: ev.reservations_enabled, days: ev.reservation_days, cutoffHours: ev.reservation_cutoff_hours },
      occupancy: { ...occ, occupiedPct: occ.capacity ? Math.round(((occ.sold + occ.reserved) / occ.capacity) * 1000) / 10 : 0 },
      counts,
      reservations,
    });
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    const r = await db().query(
      `UPDATE catalog.events SET reservations_enabled = $3, reservation_days = COALESCE($4, reservation_days),
              reservation_cutoff_hours = COALESCE($5, reservation_cutoff_hours), updated_at = now()
        WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId, parsed.data.enabled, parsed.data.days ?? null, parsed.data.cutoffHours ?? null],
    );
    if (!r.rowCount) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ ok: true });
  });
}
