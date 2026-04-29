import { NextRequest, NextResponse } from 'next/server';
import { getSeasonPassService } from '../../../../lib/service-registry';
import { getAuthenticatedUserId } from '../../../../lib/auth';

// =============================================================================
// POST /api/pass-types/admin — create a new pass type (organizer only)
// =============================================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const { name, kind, billingCycle, price, totalUses, validMonths, benefits } =
    body as Record<string, unknown>;

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'MISSING_REQUIRED_FIELD', field: 'name' }, { status: 422 });
  }
  if (!kind || !['season', 'flex'].includes(kind as string)) {
    return NextResponse.json({ error: 'INVALID_FIELD', field: 'kind' }, { status: 422 });
  }
  if (!billingCycle || !['monthly', 'annual', 'one_time'].includes(billingCycle as string)) {
    return NextResponse.json({ error: 'INVALID_FIELD', field: 'billingCycle' }, { status: 422 });
  }
  if (typeof price !== 'number' || price < 0) {
    return NextResponse.json({ error: 'INVALID_FIELD', field: 'price' }, { status: 422 });
  }
  if (typeof validMonths !== 'number' || validMonths < 1) {
    return NextResponse.json({ error: 'INVALID_FIELD', field: 'validMonths' }, { status: 422 });
  }

  const service = getSeasonPassService();

  try {
    const passType = await service.createPassType(userId, {
      name: name as string,
      kind: kind as 'season' | 'flex',
      billingCycle: billingCycle as 'monthly' | 'annual' | 'one_time',
      price: price as number,
      totalUses: totalUses as number | undefined,
      validMonths: validMonths as number,
      benefits: (benefits ?? { addonDiscountPercent: 0, earlyAccessHours: 0, guestPasses: 0 }) as {
        addonDiscountPercent: number;
        earlyAccessHours: number;
        guestPasses: number;
      },
    });

    return NextResponse.json({ data: passType }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.startsWith('PASS_TYPE_FLEX_REQUIRES')) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    if (msg.startsWith('PASS_TYPE_INVALID')) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    console.error('[pass-types/admin] POST error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
