/**
 * GET /api/blacklist/check?userId=&promoterId=
 *
 * Returns the active ban entry for the user, or null if not banned.
 * Anti-enumeration: always returns 200 with { banned: false } rather than 404.
 *
 * Callers: internal services (e.g. purchase flow) that need to gate access.
 * Role: 'service' or 'admin'. Buyers cannot query other users' ban status.
 *
 * Headers:
 *   x-user-id   — authenticated caller's UUID
 *   x-user-role — 'service' | 'admin' | 'promoter'
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkBan } from '../../../../services/blacklist.service';
import type { UserRole } from '../../../../types/blacklist.types';
import { toHttpError } from '../../../../types/blacklist.types';
import { getServiceContainer } from '../../../../lib/service-container';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const role = (request.headers.get('x-user-role') ?? 'buyer') as UserRole;

  if (role !== 'admin' && role !== 'service' && role !== 'promoter') {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const userId = searchParams.get('userId');
  const promoterId = searchParams.get('promoterId') ?? undefined;

  if (!userId) {
    return NextResponse.json(
      { error: 'userId query parameter is required.', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  try {
    const deps = getServiceContainer();
    const entry = await checkBan(deps, userId, promoterId);

    if (entry === null) {
      return NextResponse.json({ banned: false, entry: null });
    }

    return NextResponse.json({ banned: true, entry });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
