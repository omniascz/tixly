import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';


export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  await db().query(
    `UPDATE audit.anomaly_alerts
     SET acknowledged_at = NOW(), acknowledged_by_user_id = $2
     WHERE id = $1 AND promoter_id = $3`,
    [params.id, promoter.userId, promoter.promoterId],
  );
  return NextResponse.json({ ok: true });

  });
}
