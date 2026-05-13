// POST /api/gift-vouchers/[voucherId]/cancel
// Cancels an issued or sent voucher. Owner only.
// The caller is responsible for initiating a refund if appropriate.

import { NextRequest, NextResponse } from 'next/server';
import { GiftVoucherService } from '../../../../../services/gift-voucher.service';
import { voucherErrorToHttp } from '../../../../../types/gift-voucher.types';
import { getDb } from '../../../../../lib/db';

interface RouteParams {
  params: { voucherId: string };
}

const service = new GiftVoucherService();

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const db = getDb();
    await service.cancelVoucher(params.voucherId, userId, db);
    // 204: cancelled; caller may inspect remaining_value from their own records for refund purposes
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const { status, body } = voucherErrorToHttp(err);
    return NextResponse.json(body, { status });
  }
}
