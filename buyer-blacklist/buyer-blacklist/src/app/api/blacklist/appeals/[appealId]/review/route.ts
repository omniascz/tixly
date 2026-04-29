/**
 * POST /api/blacklist/appeals/[appealId]/review — review an appeal
 *
 * Body: { decision: 'approved' | 'rejected' }
 * Admins can review any appeal.
 * Promoters can review appeals for their own bans.
 *
 * If decision = 'approved', the ban is automatically lifted.
 *
 * Headers:
 *   x-user-id      — authenticated user's UUID
 *   x-user-role    — 'admin' | 'promoter'
 *   x-promoter-id  — required when role = 'promoter'
 */
import { NextRequest, NextResponse } from 'next/server';
import { reviewAppeal } from '../../../../../../services/blacklist.service';
import type { UserRole, AppealDecision } from '../../../../../../types/blacklist.types';
import { toHttpError } from '../../../../../../types/blacklist.types';
import { getServiceContainer } from '../../../../../../lib/service-container';

export async function POST(
  request: NextRequest,
  { params }: { params: { appealId: string } },
): Promise<NextResponse> {
  const callerId = request.headers.get('x-user-id');
  const role = (request.headers.get('x-user-role') ?? 'buyer') as UserRole;
  const callerPromoterId = request.headers.get('x-promoter-id') ?? undefined;

  if (!callerId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  if (role !== 'admin' && role !== 'promoter') {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  if (role === 'promoter' && !callerPromoterId) {
    return NextResponse.json(
      { error: 'x-promoter-id header required for promoter role.', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  try {
    const body = await request.json() as Record<string, unknown>;

    if (body['decision'] !== 'approved' && body['decision'] !== 'rejected') {
      return NextResponse.json(
        { error: "decision must be 'approved' or 'rejected'.", code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const deps = getServiceContainer();
    const appeal = await reviewAppeal(
      deps,
      params.appealId,
      body['decision'] as AppealDecision,
      callerId,
      role,
      callerPromoterId,
    );

    return NextResponse.json(appeal);
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
