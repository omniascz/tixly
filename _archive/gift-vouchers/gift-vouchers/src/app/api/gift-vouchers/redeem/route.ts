// POST /api/gift-vouchers/redeem
// Validates a voucher code and reserves its value against an order.
// Does NOT create an order or charge money — that is the order service's job.
// Can be called by authenticated users or (with a service token) by the order service.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { GiftVoucherService } from '../../../../services/gift-voucher.service';
import { voucherErrorToHttp } from '../../../../types/gift-voucher.types';
import { validateVoucherCode } from '../../../../lib/voucher-generator';
import { getDb } from '../../../../lib/db';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const OrderItemSchema = z.object({
  ticket_type_id: z.string().uuid(),
  event_id: z.string().uuid(),
  quantity: z.number().int().min(1),
  unit_price: z.number().int().min(0),
});

const RedeemSchema = z.object({
  code: z.string().refine(validateVoucherCode, {
    message: 'Invalid voucher code format. Expected XXXX-XXXX-XXXX-XXXX.',
  }),
  order_items: z.array(OrderItemSchema).min(1),
  user_id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const service = new GiftVoucherService();

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'BAD_REQUEST' }, { status: 400 });
  }

  const parsed = RedeemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const db = getDb();
    const result = await service.redeemVoucher(parsed.data, db);
    return NextResponse.json({ data: result });
  } catch (err) {
    const { status, body: errBody } = voucherErrorToHttp(err);
    return NextResponse.json(errBody, { status });
  }
}
