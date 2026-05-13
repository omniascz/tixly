// =============================================================================
// POST /api/payments/wero/initiate
//
// Initiates a Wero A2A payment. Creates payment record in DB, calls Wero API.
// Returns redirect URL for user authorization.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { withTenantAuth } from '@tixly/auth';
import { createDatabaseAdapter } from '@tixly/database';
import { createWeroClient } from '../../../lib/wero-client.js';
import { initiateWeroPayment } from '../../../services/wero-payment.service.js';
import { WeroError } from '../../../lib/wero-errors.js';

interface InitiateRequest {
  orderId: string;
  returnUrl: string;
}

export const POST = withTenantAuth(async (req: NextRequest) => {
  try {
    const body = (await req.json()) as InitiateRequest;

    const { orderId, returnUrl } = body;

    if (!orderId || typeof orderId !== 'string') {
      return NextResponse.json(
        { error: 'INVALID_REQUEST', message: 'orderId is required' },
        { status: 400 },
      );
    }

    if (!returnUrl || typeof returnUrl !== 'string') {
      return NextResponse.json(
        { error: 'INVALID_REQUEST', message: 'returnUrl is required' },
        { status: 400 },
      );
    }

    // Validate returnUrl is a valid URL
    try {
      new URL(returnUrl);
    } catch {
      return NextResponse.json(
        { error: 'INVALID_REQUEST', message: 'returnUrl must be a valid URL' },
        { status: 400 },
      );
    }

    // Get database and auth context
    const db = createDatabaseAdapter();
    const promoterId = (req as any).user?.promoterId;

    if (!promoterId) {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'No promoter context' },
        { status: 401 },
      );
    }

    // Check order status
    const [order] = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM orders.orders WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
      [orderId, promoterId],
    );

    if (!order) {
      return NextResponse.json(
        { error: 'ORDER_NOT_FOUND', message: 'Order not found or not accessible' },
        { status: 404 },
      );
    }

    if (order.status !== 'pending') {
      return NextResponse.json(
        { error: 'INVALID_ORDER_STATE', message: 'Order must be in pending status' },
        { status: 409 },
      );
    }

    // Get order amount
    const [orderData] = await db.query<{ total_halire: number }>(
      `SELECT COALESCE(SUM(unit_price_halire * quantity), 0) as total_halire
       FROM orders.order_items WHERE order_id = $1`,
      [orderId],
    );

    const amountHalire = orderData?.total_halire ?? 0;

    if (amountHalire <= 0) {
      return NextResponse.json(
        { error: 'INVALID_AMOUNT', message: 'Order amount must be greater than 0' },
        { status: 400 },
      );
    }

    // Create Wero client and initiate payment
    const weroClient = createWeroClient(
      process.env.WERO_CLIENT_ID ?? '',
      process.env.WERO_CLIENT_SECRET ?? '',
    );

    const result = await initiateWeroPayment(
      orderId,
      promoterId,
      amountHalire,
      returnUrl,
      { db, weroClient },
    );

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('[wero-payments] initiate error:', err);

    if (WeroError.isWeroError(err)) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to initiate payment' },
      { status: 500 },
    );
  }
});
