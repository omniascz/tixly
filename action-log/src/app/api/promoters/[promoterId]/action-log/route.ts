import { NextRequest, NextResponse } from 'next/server';
import { listActions } from '../../../../../services/action-log.service.js';
import { isActionLogError } from '../../../../../lib/action-errors.js';
import type { ServiceDeps } from '../../../../../lib/service-container.js';

declare const getDeps: () => ServiceDeps;

export async function GET(
  req: NextRequest,
  { params }: { params: { promoterId: string } },
) {
  try {
    const sp = req.nextUrl.searchParams;
    const filters = {
      entityType: sp.get('entityType') ?? undefined,
      entityId: sp.get('entityId') ?? undefined,
      actorUserId: sp.get('actorUserId') ?? undefined,
      from: sp.get('from') ? new Date(sp.get('from')!) : undefined,
      to: sp.get('to') ? new Date(sp.get('to')!) : undefined,
    };
    const pagination = {
      limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
      offset: sp.get('offset') ? Number(sp.get('offset')) : undefined,
    };
    const deps = getDeps();
    const result = await listActions(params.promoterId, filters, pagination, deps);
    return NextResponse.json(result);
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
