import { NextRequest, NextResponse } from 'next/server';
import { SeasonPassService } from '../../../services/season-pass.service';
import { CreateSeasonPassRequest } from '../../../types/season-pass';
import { getAuthenticatedUserId } from '../../../lib/auth';
import { getSeasonPassService } from '../../../lib/service-registry';

// GET /api/passes — list all passes for the authenticated user
export async function GET(request: NextRequest): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const service = getSeasonPassService();
  const passes = await service.listPassesForUser(userId);

  return NextResponse.json({ data: passes });
}

// POST /api/passes — purchase a new pass
export async function POST(request: NextRequest): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: CreateSeasonPassRequest;
  try {
    body = (await request.json()) as CreateSeasonPassRequest;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  if (!body.passTypeId || !body.organizerId || !body.kind || !body.billingCycle) {
    return NextResponse.json(
      { error: 'MISSING_REQUIRED_FIELDS', required: ['passTypeId', 'organizerId', 'kind', 'billingCycle'] },
      { status: 422 }
    );
  }

  const service = getSeasonPassService();

  try {
    const { pass, gopayRedirectUrl } = await service.purchasePass(userId, body);
    return NextResponse.json({ pass, gopayRedirectUrl }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.startsWith('PASS_TYPE_NOT_FOUND')) {
      return NextResponse.json({ error: 'PASS_TYPE_NOT_FOUND' }, { status: 404 });
    }
    if (message.startsWith('PASS_TYPE_INACTIVE')) {
      return NextResponse.json({ error: 'PASS_TYPE_INACTIVE' }, { status: 422 });
    }
    if (message.startsWith('DUPLICATE_PASS')) {
      return NextResponse.json({ error: 'DUPLICATE_PASS' }, { status: 409 });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
