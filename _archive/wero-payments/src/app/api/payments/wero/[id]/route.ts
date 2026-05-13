// =============================================================================
// GET /api/payments/wero/:id
// POST /api/payments/wero/:id/status (internal)
//
// GET: Fetch payment status
// POST: Internal endpoint to update status (used by webhook handler)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { withTenantAuth } from '@tixly/auth';
import { createDatabaseAdapter } from '@tixly/database';
import type { WeroPaymentStatusResponse } from '../../../types/wero.js';
import { WeroError } from '../../../lib/wero-errors.js';

interface Params {
  id: string;
}

// GET /api/payments/wero/:id — Public access (no auth required for status check)
export async function GET(req: NextRequest, { params }: { params: Params }) {
  try {
    const { id } = params;

    const db = createDatabaseAdapter();

    // Fetch payment by ID or external ID
    const [payment] = await db.query<{
      id: string;
      status: string;
      order_id: string;
      amount_halire: number;
      initiated_at: string;
      confirmed_at: string | null;
    }>(
      `SELECT id, status, order_id, amount_halire, initiated_at, confirmed_at
       FROM payments.wero_payments
       WHERE id = $1 OR external_id = $1 LIMIT 1`,
      [id],
    );

    if (!payment) {
      return NextResponse.json(
        { error: 'PAYMENT_NOT_FOUND', message: 'Payment not found' },
        { status: 404 },
      );
    }

    const response: WeroPaymentStatusResponse = {
      id: payment.id,
      status: payment.status as any,
      orderId: payment.order_id,
      amountHalire: payment.amount_halire,
      initiatedAt: payment.initiated_at,
      ...(payment.confirmed_at && { confirmedAt: payment.confirmed_at }),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error('[wero-payments] GET payment error:', err);

    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to fetch payment' },
      { status: 500 },
    );
  }
}

// POST /api/payments/wero/:id/status — Internal status update endpoint
export async function POST(req: NextRequest, { params }: { params: Params }) {
  try {
    // Verify internal API secret
    const secret = req.headers.get('x-internal-secret');
    if (secret !== process.env.INTERNAL_API_SECRET) {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Invalid internal secret' },
        { status: 401 },
      );
    }

    const { id } = params;
    const body = (await req.json()) as {
      status: string;
      errorCode?: string;
      errorMessage?: string;
    };

    const db = createDatabaseAdapter();

    // Update payment status
    const [updated] = await db.query<{ id: string; status: string }>(
      `UPDATE payments.wero_payments
       SET status = $1,
           error_code = $2,
           error_message = $3,
           updated_at = NOW()
       WHERE id = $4 OR external_id = $4
       RETURNING id, status`,
      [body.status, body.errorCode ?? null, body.errorMessage ?? null, id],
    );

    if (!updated) {
      return NextResponse.json(
        { error: 'PAYMENT_NOT_FOUND', message: 'Payment not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ id: updated.id, status: updated.status }, { status: 200 });
  } catch (err) {
    console.error('[wero-payments] POST status error:', err);

    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to update payment' },
      { status: 500 },
    );
  }
}
