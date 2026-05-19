/**
 * POST /api/platform/venues/[id]/seating-chart/versions/[chartId]/restore
 *
 * Vytvoří NOVOU verzi z obsahu staré verze a označí ji active. Stará verze zůstává v
 * historii, takže lze v případě regresí znovu rollback. Tím nikdy nemažeme audit trail.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { logAction, extractRequestContext } from '@/lib/audit/log';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; chartId: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const sourceRow = await client.query<{
      name: string; layout: unknown; total_seats: number; venue_id: string;
    }>(
      `SELECT name, layout, total_seats, venue_id
         FROM catalog.venue_seating_charts
        WHERE id = $1 AND venue_id = $2`,
      [params.chartId, params.id],
    );
    if (!sourceRow.rows.length) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }
    const src = sourceRow.rows[0];

    await client.query(
      `UPDATE catalog.venue_seating_charts SET active = false WHERE venue_id = $1`,
      [params.id],
    );

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO catalog.venue_seating_charts
         (venue_id, name, layout, total_seats, active, created_by_user_id, notes, source)
       VALUES ($1, $2, $3::jsonb, $4, true, $5, $6, 'restore')
       RETURNING id`,
      [
        params.id,
        `${src.name} (restored)`,
        JSON.stringify(src.layout),
        src.total_seats,
        admin.userId,
        `Restored from chart ${params.chartId}`,
      ],
    );

    await client.query(
      `UPDATE catalog.venues
          SET last_modified_by_user_id = $1, last_modified_at = NOW()
        WHERE id = $2`,
      [admin.userId, params.id],
    );

    await client.query('COMMIT');

    const reqCtx = extractRequestContext(req);
    void logAction({
      actorUserId: admin.userId,
      actorRole: 'platform_admin',
      action: 'venue.seating_chart.restore',
      targetType: 'venue',
      targetId: params.id,
      metadata: {
        sourceChartId: params.chartId,
        newChartId: inserted.rows[0].id,
        totalSeats: src.total_seats,
      },
      ip: reqCtx.ip,
      userAgent: reqCtx.userAgent,
    });

    return NextResponse.json({ id: inserted.rows[0].id, totalSeats: src.total_seats });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seating-chart restore]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
