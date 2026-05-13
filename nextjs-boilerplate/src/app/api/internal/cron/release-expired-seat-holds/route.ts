/**
 * POST /api/internal/cron/release-expired-seat-holds
 *
 * Vyčistí expirované seat holdy v `catalog.event_seats`. Volá se cca každou
 * minutu z external scheduleru (Vercel Cron, K8s CronJob, Railway Cron).
 *
 * Bez tohoto cronu by expired holdy zůstávaly držet sedadla věčně — jiný
 * kupec by je nemohl rezervovat, protože hold/route.ts zruší pouze své vlastní
 * předchozí holdy (per session tag). Pro multi-buyer kontení je nutný
 * background sweep.
 *
 * Auth: x-internal-token (timing-safe equal).
 *
 * Response: { releasedCount: number, ts: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { timingSafeEqual } from 'crypto';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const r = await db().query<{ id: string }>(
    `UPDATE catalog.event_seats
     SET status = 'available',
         hold_user_id = NULL,
         hold_until = NULL,
         notes = NULL,
         updated_at = NOW()
     WHERE status = 'held'
       AND hold_until IS NOT NULL
       AND hold_until < NOW()
     RETURNING id`,
  );

  return NextResponse.json({
    releasedCount: r.rows.length,
    ts: new Date().toISOString(),
  });
}
