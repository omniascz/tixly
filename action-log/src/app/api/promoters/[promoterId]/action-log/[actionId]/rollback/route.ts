import { NextRequest, NextResponse } from 'next/server';
import { rollbackAction } from '../../../../../../../services/action-log.service.js';
import { isActionLogError } from '../../../../../../../lib/action-errors.js';
import type { ServiceDeps } from '../../../../../../../lib/service-container.js';

declare const getDeps: () => ServiceDeps;

export async function POST(
  req: NextRequest,
  { params }: { params: { promoterId: string; actionId: string } },
) {
  try {
    const userId = req.headers.get('x-admin-user-id') ?? req.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Chybí identifikace uživatele.' },
        { status: 401 },
      );
    }
    const deps = getDeps();
    const action = await rollbackAction(
      params.actionId,
      params.promoterId,
      userId,
      deps,
    );
    return NextResponse.json(action);
  } catch (err) {
    if (isActionLogError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Došlo k neočekávané chybě.' },
      { status: 500 },
    );
  }
}
