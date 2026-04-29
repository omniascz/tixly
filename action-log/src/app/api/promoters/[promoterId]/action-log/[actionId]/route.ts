import { NextRequest, NextResponse } from 'next/server';
import { getAction } from '../../../../../../services/action-log.service.js';
import { isActionLogError } from '../../../../../../lib/action-errors.js';
import type { ServiceDeps } from '../../../../../../lib/service-container.js';

declare const getDeps: () => ServiceDeps;

export async function GET(
  _req: NextRequest,
  { params }: { params: { promoterId: string; actionId: string } },
) {
  try {
    const deps = getDeps();
    const action = await getAction(params.actionId, params.promoterId, deps);
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
