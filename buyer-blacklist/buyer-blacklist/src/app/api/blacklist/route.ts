/**
 * GET  /api/blacklist  — list bans
 * POST /api/blacklist  — ban a user
 *
 * Headers (simulating JWT middleware output):
 *   x-user-id   — authenticated user's UUID
 *   x-user-role — 'admin' | 'promoter' | 'buyer' | 'service'
 *   x-promoter-id — set when role = 'promoter'
 */
import { NextRequest, NextResponse } from 'next/server';
import { banUser, listBans } from '../../../services/blacklist.service';
import type { BanScope, UserRole } from '../../../types/blacklist.types';
import { toHttpError } from '../../../types/blacklist.types';
import { getServiceContainer } from '../../../lib/service-container';

// ---------------------------------------------------------------------------
// GET /api/blacklist
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  const role = (request.headers.get('x-user-role') ?? 'buyer') as UserRole;
  const callerPromoterId = request.headers.get('x-promoter-id') ?? undefined;

  if (role !== 'admin' && role !== 'promoter') {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const filterPromoterId = searchParams.get('promoterId') ?? undefined;
  const scope = searchParams.get('scope') as BanScope | null ?? undefined;

  try {
    const deps = getServiceContainer();
    const entries = await listBans(deps, role, callerPromoterId, filterPromoterId, scope);
    return NextResponse.json({ data: entries });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}

// ---------------------------------------------------------------------------
// POST /api/blacklist — ban a user
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  const callerId = request.headers.get('x-user-id');
  const role = (request.headers.get('x-user-role') ?? 'buyer') as UserRole;
  const callerPromoterId = request.headers.get('x-promoter-id') ?? undefined;

  if (!callerId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  if (role !== 'admin' && role !== 'promoter') {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  try {
    const body = await request.json() as Record<string, unknown>;

    if (typeof body['userId'] !== 'string' || typeof body['email'] !== 'string' || typeof body['reason'] !== 'string') {
      return NextResponse.json(
        { error: 'userId, email, and reason are required strings.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const scope: BanScope = body['scope'] === 'platform' ? 'platform' : 'promoter';
    const promoterId = typeof body['promoterId'] === 'string' ? body['promoterId'] : callerPromoterId;

    const deps = getServiceContainer();
    const entry = await banUser(
      deps,
      {
        userId: body['userId'],
        email: body['email'],
        promoterId,
        scope,
        reason: body['reason'],
        bannedBy: callerId,
      },
      role,
    );

    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
