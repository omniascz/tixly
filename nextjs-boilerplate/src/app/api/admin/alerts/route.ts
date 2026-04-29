/**
 * GET /api/admin/alerts — list alerts pro promotéra
 * POST /api/admin/alerts/[id]/ack — acknowledge
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const showAck = req.nextUrl.searchParams.get('all') === 'true';
  const r = await db().query<{
    id: string;
    event_id: string | null;
    event_title: string | null;
    alert_type: string;
    severity: string;
    message: string;
    metadata: Record<string, unknown>;
    acknowledged_at: string | null;
    created_at: string;
  }>(
    `SELECT a.id, a.event_id, e.title AS event_title,
            a.alert_type, a.severity, a.message, a.metadata,
            a.acknowledged_at, a.created_at
     FROM audit.anomaly_alerts a
     LEFT JOIN catalog.events e ON e.id = a.event_id
     WHERE a.promoter_id = $1
       ${showAck ? '' : 'AND a.acknowledged_at IS NULL'}
     ORDER BY a.created_at DESC
     LIMIT 100`,
    [promoter.promoterId],
  );
  return NextResponse.json({ alerts: r.rows });
}
