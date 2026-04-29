import { NextRequest, NextResponse } from 'next/server';
import { getServiceContainer } from '../../../../../lib/service-container';
import { toHttpError } from '../../../../../types/flash-sale.types';

// ---------------------------------------------------------------------------
// GET /api/flash-sales/[flashSaleId]/countdown
//
// Lightweight polling endpoint for UI countdown timers.
// Response shape:
//   {
//     startsAt, endsAt, now,
//     secondsUntilStart, secondsUntilEnd,
//     isActive, remainingUses
//   }
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: { flashSaleId: string } },
): Promise<NextResponse> {
  try {
    const { db } = getServiceContainer();
    const sale = await db.findFlashSale(params.flashSaleId);

    if (sale === null) {
      return NextResponse.json(
        { error: `Flash sale ${params.flashSaleId} not found.`, code: 'FLASH_SALE_NOT_FOUND' },
        { status: 404 },
      );
    }

    const now = new Date();
    const startsAt = new Date(sale.starts_at);
    const endsAt = new Date(sale.ends_at);

    const secondsUntilStart = Math.max(
      0,
      Math.floor((startsAt.getTime() - now.getTime()) / 1000),
    );
    const secondsUntilEnd = Math.max(
      0,
      Math.floor((endsAt.getTime() - now.getTime()) / 1000),
    );

    const remainingUses = Math.max(
      0,
      sale.flash_capacity - sale.flash_sold_count,
    );

    const isActive =
      sale.status === 'active' &&
      now >= startsAt &&
      now < endsAt &&
      remainingUses > 0;

    return NextResponse.json(
      {
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        now: now.toISOString(),
        secondsUntilStart,
        secondsUntilEnd,
        isActive,
        remainingUses,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
