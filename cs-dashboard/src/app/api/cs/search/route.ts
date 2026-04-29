import { NextRequest, NextResponse } from 'next/server';
import { globalSearch } from '../../../../services/cs-extended.service.js';
import { isCsError, CsError } from '../../../../lib/cs-errors.js';
import type { CsExtDeps } from '../../../../services/cs-extended.service.js';

function requireAdmin(req: NextRequest): string | null {
  const userId = req.headers.get('x-user-id');
  const isAdmin = req.headers.get('x-is-admin');
  if (!userId || isAdmin !== 'true') return null;
  return userId;
}

export function makeSearchHandler(deps: CsExtDeps) {
  return async function GET(req: NextRequest) {
    const csUserId = requireAdmin(req);
    if (!csUserId) {
      const err = new CsError('FORBIDDEN');
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }

    const q = req.nextUrl.searchParams.get('q') ?? '';

    try {
      const result = await globalSearch(q, deps);
      return NextResponse.json(result);
    } catch (err) {
      if (isCsError(err)) {
        return NextResponse.json(err.toHttpError(), { status: err.statusCode });
      }
      throw err;
    }
  };
}

// Default export (no-DI stub — replace via makeSearchHandler in app bootstrap)
export async function GET(req: NextRequest) {
  return NextResponse.json({ error: 'DB_NOT_INJECTED' }, { status: 500 });
}
