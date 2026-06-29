import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const patchSchema = z.object({ seats: z.number().int().min(0).max(5) });

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (ctx) => {
    const r = await db().query<{ social_distance_seats: number }>(
      `SELECT social_distance_seats FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [params.id, ctx.promoterId],
    );
    if (r.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ socialDistanceSeats: r.rows[0].social_distance_seats });
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (ctx) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, { status: 422 });
    }
    const r = await db().query<{ id: string }>(
      `UPDATE catalog.events SET social_distance_seats = $1 WHERE id = $2 AND promoter_id = $3 RETURNING id`,
      [parsed.data.seats, params.id, ctx.promoterId],
    );
    if (r.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ ok: true, socialDistanceSeats: parsed.data.seats });
  });
}
