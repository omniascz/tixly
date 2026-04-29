import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getServiceDeps } from '../../../../../lib/service-container.js';

// POST /api/bank/payments/manual
// Admin records a payment received outside the gateway (cash, direct bank
// transfer, SEPA, etc). Inserts into payments.bank_payments already matched
// to an order, so reconciliation treats it as settled.
//
// Body: { orderId, amountHalire, currency?, method: 'cash'|'bank_transfer'|'other', note? }
const BodySchema = z.object({
  orderId: z.string().min(1),
  amountHalire: z.number().int().positive(),
  currency: z.string().length(3).optional(),
  method: z.enum(['cash', 'bank_transfer', 'other']),
  note: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id');
    const role = req.headers.get('x-user-role');
    if (!userId || (role !== 'admin' && role !== 'promoter_admin')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    const body = BodySchema.parse(await req.json());

    const deps = getServiceDeps();
    const fioTxId = `manual:${body.method}:${randomUUID()}`;
    const rows = await deps.db.query(
      `INSERT INTO payments.bank_payments
         (fio_transaction_id, amount_halire, currency, message, order_id,
          match_status, matched_by_user_id, raw_payload, received_at, matched_at)
       VALUES ($1, $2, $3, $4, $5, 'matched', $6,
               $7, NOW(), NOW())
       RETURNING id, order_id, amount_halire, match_status`,
      [
        fioTxId,
        body.amountHalire,
        body.currency ?? 'CZK',
        body.note ?? null,
        body.orderId,
        userId,
        JSON.stringify({ source: 'manual', method: body.method, note: body.note ?? null }),
      ],
    );
    return NextResponse.json({ payment: rows[0] }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'VALIDATION', issues: err.issues }, { status: 422 });
    }
    throw err;
  }
}
