import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';


export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPlatformAdmin(req, async (_admin) => {
  const result = await db().query<{ id: string; status: string }>(
    `UPDATE platform.promoters
       SET status = 'active', updated_at = NOW()
     WHERE id = $1 RETURNING id, status`,
    [params.id],
  );
  if (result.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ promoter: result.rows[0] });

  });
}
