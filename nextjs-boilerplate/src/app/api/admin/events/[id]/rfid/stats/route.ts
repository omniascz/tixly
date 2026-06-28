/**
 * GET /api/admin/events/[id]/rfid/stats
 * Obsazenost zón + posledních 20 scan eventů (live dashboard polling).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const evR = await db().query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
      [params.id, ctx.promoterId],
    );
    if (evR.rows.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [zonesRes, logRes] = await Promise.all([
      db().query(
        `SELECT z.id, z.name, z.code, z.capacity, z.sort_order,
                COALESCE(p.count, 0)::int AS occupancy
         FROM catalog.rfid_zones z
         LEFT JOIN (
           SELECT zone_id, COUNT(*) AS count FROM catalog.rfid_presence GROUP BY zone_id
         ) p ON p.zone_id = z.id
         WHERE z.event_id = $1
         ORDER BY z.sort_order`,
        [params.id],
      ),
      db().query(
        `SELECT l.id, l.wristband_uid, l.direction, l.result, l.scanned_at,
                z.name AS zone_name, z.code AS zone_code
         FROM catalog.rfid_access_log l
         LEFT JOIN catalog.rfid_zones z ON z.id = l.zone_id
         WHERE l.event_id = $1
         ORDER BY l.scanned_at DESC
         LIMIT 20`,
        [params.id],
      ),
    ]);

    const totalInside = (zonesRes.rows as { occupancy: number }[]).reduce((s, z) => s + z.occupancy, 0);

    return NextResponse.json({
      zones: zonesRes.rows,
      totalInside,
      recentLog: logRes.rows,
      ts: new Date().toISOString(),
    });
  });
}
