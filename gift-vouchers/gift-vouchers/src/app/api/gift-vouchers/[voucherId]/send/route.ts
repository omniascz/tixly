// POST /api/gift-vouchers/[voucherId]/send
// Marks the voucher as sent (issued → sent).
// Actual e-mail delivery is the responsibility of the email service.

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
    const voucher = await service.sendVoucher(params.voucherId, userId, db);
    return NextResponse.json({ data: voucher });
  } catch (err) {
    const { status, body } = voucherErrorToHttp(err);
    return NextResponse.json(body, { status });
  }
}
