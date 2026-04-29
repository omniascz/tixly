import { NextRequest, NextResponse } from 'next/server';
import { getMyPromoter } from '../../../../../services/promoter.service.js';
import { isPlatformError } from '../../../../../lib/platform-errors.js';
import type { ServiceDeps } from '../../../../../lib/service-container.js';

function getDeps(): ServiceDeps {
  throw new Error('ServiceDeps must be injected at runtime');
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Missing x-user-id header' }, { status: 401 });
  }

  try {
    const deps = getDeps();
    const promoter = await getMyPromoter(userId, deps);
    if (!promoter) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(promoter);
  } catch (err) {
    if (isPlatformError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
