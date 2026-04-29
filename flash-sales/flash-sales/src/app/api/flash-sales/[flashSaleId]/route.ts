import { NextRequest, NextResponse } from 'next/server';
import { FlashSaleService } from '../../../../services/flash-sale.service';
import { toHttpError, FlashSaleUnauthorizedError } from '../../../../types/flash-sale.types';
import { toPublicView } from '../../../../lib/flash-sale-calculator';
import { getServiceContainer } from '../../../../lib/service-container';

const flashSaleService = new FlashSaleService();

// ---------------------------------------------------------------------------
// GET /api/flash-sales/[flashSaleId]
//
// - Organizer (x-user-id header present + is creator): sees full FlashSale
// - Public (no header or different user): sees FlashSalePublicView
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
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

    const requestingUserId = request.headers.get('x-user-id');
    const isOrganizer =
      requestingUserId !== null &&
      requestingUserId === sale.created_by_organizer_id;

    if (isOrganizer) {
      return NextResponse.json(sale, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    // Public view — strip internal fields
    const now = new Date();
    const publicView = toPublicView(sale, now);
    return NextResponse.json(publicView, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/flash-sales/[flashSaleId]
// Organizer only — cancel a scheduled or active flash sale
// ---------------------------------------------------------------------------

export async function DELETE(
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
    await flashSaleService.cancelFlashSale(params.flashSaleId, organizerId, db);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof FlashSaleUnauthorizedError) {
      const { status, body } = toHttpError(err);
      return NextResponse.json(body, { status });
    }
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
