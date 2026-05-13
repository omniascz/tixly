import { NextRequest, NextResponse } from 'next/server';
import { getLinkStats } from '../../../../../services/affiliate.service';
import { AffiliateLinkNotFoundError } from '../../../../../types/affiliate.types';

const deps = { db: null as any, kafka: { send: async () => {} } };

export async function GET(
  request: NextRequest,
  { params }: { params: { code: string } },
) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const stats = await getLinkStats(deps, params.code, userId);
    return NextResponse.json(stats);
  } catch (err) {
    if (err instanceof AffiliateLinkNotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw err;
  }
}
