import { NextRequest, NextResponse } from 'next/server';
import { requestPayout } from '../../../../../services/ambassador.service';
import type { ServiceDeps } from '../../../../../services/ambassador.service';
import {
  AmbassadorNotFoundError,
  AmbassadorSuspendedError,
} from '../../../../../types/ambassador.types';

declare function getServiceDeps(): ServiceDeps;
declare function getUserIdFromRequest(req: NextRequest): string | null;

// ---------------------------------------------------------------------------
// POST /api/ambassador/[ambassadorId]/payout — požadavek na výplatu
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: { ambassadorId: string } },
): Promise<NextResponse> {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: 'Neautorizováno' }, { status: 401 });
  }

  try {
    const deps = getServiceDeps();
    const payout = await requestPayout(deps, params.ambassadorId, userId);
    return NextResponse.json(payout, { status: 201 });
  } catch (err) {
    if (err instanceof AmbassadorNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof AmbassadorSuspendedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof RangeError) {
      // Zůstatek pod minimem
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : 'Interní chyba serveru';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
