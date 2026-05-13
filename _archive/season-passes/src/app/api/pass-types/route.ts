import { NextRequest, NextResponse } from 'next/server';
import { getSeasonPassService } from '../../../lib/service-registry';

// GET /api/pass-types?organizerId=X — list active pass types for an organizer
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const organizerId = searchParams.get('organizerId');

  if (!organizerId) {
    return NextResponse.json(
      { error: 'MISSING_REQUIRED_PARAM', param: 'organizerId' },
      { status: 422 }
    );
  }

  const service = getSeasonPassService();
  const passTypes = await service.listPassTypes(organizerId);

  return NextResponse.json({ data: passTypes });
}
