import { NextRequest, NextResponse } from 'next/server';
import { getCsActionLog } from '../../../../services/cs-extended.service.js';
import { isCsError, CsError } from '../../../../lib/cs-errors.js';
import type { CsExtDeps } from '../../../../services/cs-extended.service.js';

function requireAdmin(req: NextRequest): string | null {
  const userId = req.headers.get('x-user-id');
  const isAdmin = req.headers.get('x-is-admin');
  if (!userId || isAdmin !== 'true') return null;
  return userId;
}

export function makeActionLogHandler(deps: CsExtDeps) {
  return async function GET(req: NextRequest) {
    const csUserId = requireAdmin(req);
    if (!csUserId) {
      const err = new CsError('FORBIDDEN');
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }

    const sp = req.nextUrl.searchParams;
    const filters = {
      entityType: sp.get('entityType') ?? undefined,
      entityId:   sp.get('entityId') ?? undefined,
      csUserId:   sp.get('csUserId') ?? undefined,
      from:       sp.get('from') ?? undefined,
      to:         sp.get('to') ?? undefined,
    };
    const pagination = {
      limit:  sp.get('limit')  ? Number(sp.get('limit'))  : undefined,
      offset: sp.get('offset') ? Number(sp.get('offset')) : undefined,
    };

    try {
      const result = await getCsActionLog(filters, pagination, deps);
      return NextResponse.json(result);
    } catch (err) {
      if (isCsError(err)) {
        return NextResponse.json(err.toHttpError(), { status: err.statusCode });
      }
      throw err;
    }
  };
}

export async function GET(req: NextRequest) {
  return NextResponse.json({ error: 'DB_NOT_INJECTED' }, { status: 500 });
}
