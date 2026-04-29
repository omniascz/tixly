/**
 * GET /api/blacklist/appeals — list appeals pending review
 *
 * Admins see all pending appeals.
 * Promoters see only appeals for their own bans.
 *
 * Headers:
 *   x-user-id    — authenticated user's UUID
 *   x-user-role  — 'admin' | 'promoter'
 *   x-promoter-id — set when role = 'promoter'
 */
import { NextRequest, NextResponse } from 'next/server';
import { listAppeals } from '../../../../services/blacklist.service';
import type { UserRole } from '../../../../types/blacklist.types';
import { toHttpError } from '../../../../types/blacklist.types';
import { getServiceContainer } from '../../../../lib/service-container';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const role = (request.headers.get('x-user-role') ?? 'buyer') as UserRole;
  const callerPromoterId = request.headers.get('x-promoter-id') ?? undefined;

  if (role !== 'admin' && role !== 'promoter') {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  try {
    const deps = getServiceContainer();
    const appeals = await listAppeals(deps, role, callerPromoterId);
    return NextResponse.json({ data: appeals });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
