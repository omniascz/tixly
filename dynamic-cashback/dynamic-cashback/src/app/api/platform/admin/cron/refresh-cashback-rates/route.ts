// POST /api/platform/admin/cron/refresh-cashback-rates
// Cron endpoint — invaliduje expirované cached sazby.

import { NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { refreshStaleRates } from '../../../../../../services/cashback.service.js';

export async function POST(req: Request): Promise<Response> {
  const cronToken = req.headers.get('x-cron-token');
  if (cronToken !== process.env.CRON_TOKEN) {
    return NextResponse.json(
      { error: 'Nedostatečná oprávnění.' },
      { status: 403 },
    );
  }

  const deps = await getServiceDeps();
  const result = await refreshStaleRates(deps);
  return NextResponse.json(result);
}
