import { NextRequest, NextResponse } from 'next/server';
import { FlashSaleService } from '../../../../../../services/flash-sale.service';
import { getServiceContainer } from '../../../../../../lib/service-container';

// ---------------------------------------------------------------------------
// POST /api/platform/admin/cron/expire-flash-sales
//
// Called every minute by the platform cron scheduler.
// Transitions:
//   - scheduled flash sales whose starts_at <= now  → active
//   - active    flash sales whose ends_at   <= now  → ended
// ---------------------------------------------------------------------------

const CRON_SECRET = process.env.PLATFORM_CRON_SECRET ?? '';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get('x-cron-secret');
  if (!CRON_SECRET || auth !== CRON_SECRET) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  const { db } = getServiceContainer();
  const service = new FlashSaleService();

  const activated = await service.processScheduledActivations(db);
  const expired = await service.processExpiredFlashSales(db);

  return NextResponse.json(
    {
      ok: true,
      activated,
      expired,
      ranAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Expire flash sales past their end time.
 * Exposed separately so other modules / tests can import it directly.
 */
export async function expireOldFlashSales(
  deps: { db: Parameters<FlashSaleService['processExpiredFlashSales']>[0] },
): Promise<number> {
  const service = new FlashSaleService();
  return service.processExpiredFlashSales(deps.db);
}
