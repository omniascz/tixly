import { NextRequest, NextResponse } from 'next/server';
import { FlashSaleService } from '../../../../../services/flash-sale.service';
import { toHttpError } from '../../../../../types/flash-sale.types';
import { getServiceContainer } from '../../../../../lib/service-container';

const flashSaleService = new FlashSaleService();

// ---------------------------------------------------------------------------
// POST /api/flash-sales/[flashSaleId]/activate
// Organizer only — manually activates a flash sale before its scheduled starts_at
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: { flashSaleId: string } },
): Promise<NextResponse> {
  const organizerId = request.headers.get('x-user-id');
  if (!organizerId) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  try {
    const { db } = getServiceContainer();
    const sale = await flashSaleService.activateFlashSale(
      params.flashSaleId,
      organizerId,
      db,
    );
    return NextResponse.json(sale, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
