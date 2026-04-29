import { NextRequest, NextResponse } from 'next/server';
import { createAmbassador, listAmbassadors } from '../../../services/ambassador.service';
import type { ServiceDeps } from '../../../services/ambassador.service';

// V produkci nahradit skutečnými DI adaptéry
declare function getServiceDeps(): ServiceDeps;
declare function getPromoterIdFromRequest(req: NextRequest): string | null;

// ---------------------------------------------------------------------------
// GET /api/ambassador — seznam ambassadorů pořadatele
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest): Promise<NextResponse> {
  const promoterId = getPromoterIdFromRequest(req);
  if (!promoterId) {
    return NextResponse.json({ error: 'Neautorizováno' }, { status: 401 });
  }

  try {
    const deps = getServiceDeps();
    const ambassadors = await listAmbassadors(deps, promoterId);
    return NextResponse.json(ambassadors);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Interní chyba serveru';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/ambassador — registrace nového ambassadora
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
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

  if (
    typeof body !== 'object' || body === null ||
    typeof (body as Record<string, unknown>).userId !== 'string' ||
    typeof (body as Record<string, unknown>).name !== 'string' ||
    typeof (body as Record<string, unknown>).commissionRateBps !== 'number'
  ) {
    return NextResponse.json(
      { error: 'Povinná pole: userId (string), name (string), commissionRateBps (number)' },
      { status: 400 },
    );
  }

  const data = body as {
    userId: string;
    name: string;
    commissionRateBps: number;
    tier?: 'bronze' | 'silver' | 'gold';
  };

  try {
    const deps = getServiceDeps();
    const ambassador = await createAmbassador(deps, promoterId, data);
    return NextResponse.json(ambassador, { status: 201 });
  } catch (err) {
    if (err instanceof RangeError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Interní chyba serveru';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
