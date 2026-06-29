/**
 * PATCH  /api/admin/events/[id]/travel/[packageId] — update package
 * DELETE /api/admin/events/[id]/travel/[packageId] — remove package
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; packageId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    let body: {
      totalCapacity?: number;
      pricePerNightOverrideHalire?: number | null;
      active?: boolean;
      displayOrder?: number;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
    }

    const client = await db().connect();
    try {
      // Verify event belongs to promoter and package belongs to event
      const own = await client.query(
        `SELECT 1 FROM catalog.event_travel_packages p
           JOIN catalog.events e ON e.id = p.event_id
          WHERE p.id = $1 AND p.event_id = $2 AND e.promoter_id = $3`,
        [params.packageId, params.id, ctx.promoterId],
      );
      if (own.rowCount === 0) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

      await client.query(
        `UPDATE catalog.event_travel_packages
            SET total_capacity                  = COALESCE($3, total_capacity),
                active                          = COALESCE($4, active),
                display_order                   = COALESCE($5, display_order),
                price_per_night_override_halire = CASE WHEN $6 THEN $7::int ELSE price_per_night_override_halire END,
                updated_at                      = now()
          WHERE id = $1 AND event_id = $2`,
        [
          params.packageId,
          params.id,
          body.totalCapacity ?? null,
          body.active ?? null,
          body.displayOrder ?? null,
          body.pricePerNightOverrideHalire !== undefined,
          body.pricePerNightOverrideHalire ?? null,
        ],
      );

      return NextResponse.json({ updated: true });
    } finally {
      client.release();
    }
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; packageId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const client = await db().connect();
    try {
      // Verify ownership
      const own = await client.query(
        `SELECT 1 FROM catalog.event_travel_packages p
           JOIN catalog.events e ON e.id = p.event_id
          WHERE p.id = $1 AND p.event_id = $2 AND e.promoter_id = $3`,
        [params.packageId, params.id, ctx.promoterId],
      );
      if (own.rowCount === 0) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

      // Refuse delete if confirmed bookings exist
      const b = await client.query(
        `SELECT 1 FROM orders.travel_bookings
          WHERE package_id = $1 AND status = 'confirmed'
          LIMIT 1`,
        [params.packageId],
      );
      if ((b.rowCount ?? 0) > 0) {
        return NextResponse.json(
          { error: 'HAS_BOOKINGS', message: 'Nelze smazat balíček s existujícími rezervacemi. Deaktivuj ho místo toho.' },
          { status: 409 },
        );
      }

      await client.query(
        `DELETE FROM catalog.event_travel_packages WHERE id = $1 AND event_id = $2`,
        [params.packageId, params.id],
      );

      return NextResponse.json({ deleted: params.packageId });
    } finally {
      client.release();
    }
  });
}
