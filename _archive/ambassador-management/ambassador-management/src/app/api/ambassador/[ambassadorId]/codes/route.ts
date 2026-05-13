import { NextRequest, NextResponse } from 'next/server';
import { assignCode } from '../../../../../services/ambassador.service';
import type { ServiceDeps } from '../../../../../services/ambassador.service';
import {
  AmbassadorNotFoundError,
  AmbassadorSuspendedError,
} from '../../../../../types/ambassador.types';

declare function getServiceDeps(): ServiceDeps;
declare function getPromoterIdFromRequest(req: NextRequest): string | null;

// ---------------------------------------------------------------------------
// POST /api/ambassador/[ambassadorId]/codes — přidělení promo kódu
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: { ambassadorId: string } },
): Promise<NextResponse> {
  const promoterId = getPromoterIdFromRequest(req);
  if (!promoterId) {
    return NextResponse.json({ error: 'Neautorizováno' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Neplatné JSON tělo požadavku' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  if (
    typeof b.maxUses !== 'number' ||
    typeof b.discountBps !== 'number' ||
    typeof b.validUntil !== 'string'
  ) {
    return NextResponse.json(
      { error: 'Povinná pole: maxUses (number), discountBps (number), validUntil (ISO string)' },
      { status: 400 },
    );
  }

  const validUntil = new Date(b.validUntil as string);
  if (isNaN(validUntil.getTime())) {
    return NextResponse.json({ error: 'validUntil není platné datum' }, { status: 400 });
  }

  try {
    const deps = getServiceDeps();
    const code = await assignCode(deps, promoterId, params.ambassadorId, {
      maxUses: b.maxUses as number,
      discountBps: b.discountBps as number,
      validUntil,
    });
    return NextResponse.json(code, { status: 201 });
  } catch (err) {
    if (err instanceof AmbassadorNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof AmbassadorSuspendedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof RangeError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Interní chyba serveru';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
