/**
 * POST /api/blacklist/[entryId]/appeal — submit an appeal
 *
 * Only the banned user themselves (userId from JWT) may submit an appeal.
 *
 * Headers:
 *   x-user-id — the authenticated user (must match the ban's userId)
 */
import { NextRequest, NextResponse } from 'next/server';
import { submitAppeal } from '../../../../../services/blacklist.service';
import { toHttpError } from '../../../../../types/blacklist.types';
import { getServiceContainer } from '../../../../../lib/service-container';

export async function POST(
  request: NextRequest,
  { params }: { params: { entryId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const body = await request.json() as Record<string, unknown>;

    if (typeof body['message'] !== 'string' || body['message'].trim().length === 0) {
      return NextResponse.json(
        { error: 'message is required and must be a non-empty string.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const deps = getServiceContainer();
    const appeal = await submitAppeal(deps, userId, params.entryId, body['message']);
    return NextResponse.json(appeal, { status: 201 });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
