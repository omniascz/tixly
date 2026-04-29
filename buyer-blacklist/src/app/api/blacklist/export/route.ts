/**
 * GET /api/blacklist/export
 *
 * Downloads all blacklist entries visible to the caller as a CSV file.
 * - Admins: all entries, optionally filtered by ?promoterId or ?scope.
 * - Promoters: only their own promoter-scoped entries.
 *
 * Headers:
 *   x-user-id     — authenticated caller's UUID
 *   x-user-role   — 'admin' | 'promoter'
 *   x-promoter-id — set when role = 'promoter'
 */
import { NextRequest, NextResponse } from 'next/server';
import { listBans } from '../../../../services/blacklist.service.js';
import type { BanScope, UserRole } from '../../../../types/blacklist.types.js';
import { toHttpError } from '../../../../types/blacklist.types.js';
import { getServiceContainer } from '../../../../lib/service-container.js';
import { exportBlacklistCsv } from '../../../../lib/csv-handler.js';
import { recordCsAction } from '../../../../lib/cs-audit.js';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const callerId = request.headers.get('x-user-id');
  const role = (request.headers.get('x-user-role') ?? 'buyer') as UserRole;
  const callerPromoterId = request.headers.get('x-promoter-id') ?? undefined;

  if (!callerId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (role !== 'admin' && role !== 'promoter') {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const filterPromoterId = searchParams.get('promoterId') ?? undefined;
  const scope = (searchParams.get('scope') as BanScope | null) ?? undefined;

  try {
    const deps = getServiceContainer();
    const entries = await listBans(deps, role, callerPromoterId, filterPromoterId, scope);
    const csv = exportBlacklistCsv(entries);

    try {
      await recordCsAction(deps.db, {
        actorId: callerId,
        actorRole: role,
        action: 'entry.exported',
        payload: { count: entries.length, filterPromoterId, scope },
      });
    } catch (err) {
      console.error('[buyer-blacklist] Failed to record CS audit for export:', err);
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="blacklist-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
