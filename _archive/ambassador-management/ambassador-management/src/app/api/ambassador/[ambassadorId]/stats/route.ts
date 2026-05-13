import { NextRequest, NextResponse } from 'next/server';
import { getStats } from '../../../../../services/ambassador.service';
import type { ServiceDeps } from '../../../../../services/ambassador.service';
import { AmbassadorNotFoundError } from '../../../../../types/ambassador.types';

declare function getServiceDeps(): ServiceDeps;
declare function getUserIdFromRequest(req: NextRequest): string | null;

// ---------------------------------------------------------------------------
// GET /api/ambassador/[ambassadorId]/stats — výkonnostní statistiky
// ---------------------------------------------------------------------------
export async function GET(
  req: NextRequest,
  { params }: { params: { ambassadorId: string } },
): Promise<NextResponse> {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: 'Neautorizováno' }, { status: 401 });
  }

  try {
    const deps = getServiceDeps();
    const stats = await getStats(deps, params.ambassadorId, userId);
    return NextResponse.json(stats);
  } catch (err) {
    if (err instanceof AmbassadorNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : 'Interní chyba serveru';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
