import { NextRequest, NextResponse } from 'next/server';
import { generateReceipt, getReceiptByBooking } from '../../../../../../../services/receipt.service';
import { isPortalError } from '../../../../../../../lib/portal-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { promoterId: string; bookingId: string } },
) {
  try {
    const db = getDb();
    // Try to get existing receipt first; generate if not exists
    let receipt = await getReceiptByBooking(params.bookingId, db);
    if (!receipt) {
      receipt = await generateReceipt(params.bookingId, db);
    }
    return NextResponse.json(receipt);
  } catch (err) {
    if (isPortalError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
