import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await db().query(
    `UPDATE audit.anomaly_alerts
     SET acknowledged_at = NOW(), acknowledged_by_user_id = $2
     WHERE id = $1 AND promoter_id = $3`,
    [params.id, promoter.userId, promoter.promoterId],
  );
  return NextResponse.json({ ok: true });
}
