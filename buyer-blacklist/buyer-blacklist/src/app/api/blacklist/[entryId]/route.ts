/**
 * DELETE /api/blacklist/[entryId] — lift a ban
 *
 * Headers:
 *   x-user-id      — authenticated user's UUID
 *   x-user-role    — 'admin' | 'promoter'
 *   x-promoter-id  — required when role = 'promoter'
 */
import { NextRequest, NextResponse } from 'next/server';
import { liftBan } from '../../../../services/blacklist.service';
import type { UserRole } from '../../../../types/blacklist.types';
import { toHttpError } from '../../../../types/blacklist.types';
import { getServiceContainer } from '../../../../lib/service-container';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { entryId: string } },
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
    const deps = getServiceContainer();
    const entry = await liftBan(deps, params.entryId, callerId, role, callerPromoterId);
    return NextResponse.json(entry);
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
