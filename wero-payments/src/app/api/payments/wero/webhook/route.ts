// =============================================================================
// POST /api/payments/wero/webhook
//
// Receives Wero webhook notifications. Validates signature, updates payment status.
// Always returns 200 OK (fire-and-forget async processing).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createDatabaseAdapter } from '@tixly/database';
import { createWeroClient } from '../../../lib/wero-client.js';
import {
  updatePaymentStatus,
  logWebhookEvent,
  getPaymentForOrder,
} from '../../../services/wero-payment.service.js';
import { WeroError } from '../../../lib/wero-errors.js';
import type { WeroWebhook } from '../../../types/wero.js';

// Fire-and-forget webhook handling (don't wait for order-completed)
async function handleWeroWebhook(payload: WeroWebhook, db: any): Promise<void> {
  const { paymentId, status, errorCode, errorMessage } = payload;

  if (!paymentId) {
    throw new WeroError('WERO_INVALID_WEBHOOK', 'Missing paymentId');
  }

  // Update payment status
  await updatePaymentStatus(paymentId, status, errorCode, errorMessage, db);

  // Get the payment to find the order
  const [payment] = await db.query<{ order_id: string }>(
    `SELECT order_id FROM payments.wero_payments WHERE external_id = $1 LIMIT 1`,
    [paymentId],
  );

  if (!payment) {
    return;
  }

  // If confirmed, trigger order-completed webhook (fire-and-forget)
  if (status === 'confirmed') {
    try {
      await fetch(new URL('/api/internal/order-completed', process.env.NEXTAUTH_URL).toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': process.env.INTERNAL_API_SECRET ?? '',
        },
        body: JSON.stringify({
          orderId: payment.order_id,
          paymentId,
          paymentMethod: 'wero',
        }),
      }).catch((err) => {
        console.error('[wero-payments] order-completed webhook error:', err);
      });
    } catch (err) {
      console.error('[wero-payments] Failed to trigger order-completed:', err);
    }
  }

  // If failed, trigger refund (fire-and-forget)
  if (status === 'failed') {
    try {
      await fetch(new URL('/api/internal/trigger-refund', process.env.NEXTAUTH_URL).toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': process.env.INTERNAL_API_SECRET ?? '',
        },
        body: JSON.stringify({
          orderId: payment.order_id,
          reason: `Wero payment failed: ${errorMessage}`,
        }),
      }).catch((err) => {
        console.error('[wero-payments] trigger-refund error:', err);
      });
    } catch (err) {
      console.error('[wero-payments] Failed to trigger refund:', err);
    }
  }
}

export const POST = async (req: NextRequest) => {
  const db = createDatabaseAdapter();
  const weroClient = createWeroClient(
    process.env.WERO_CLIENT_ID ?? '',
    process.env.WERO_CLIENT_SECRET ?? '',
  );

  try {
    // Get signature from header
    const signature = req.headers.get('x-wero-signature');
    if (!signature) {
      console.error('[wero-payments] Missing X-Wero-Signature header');
      // Return 200 to acknowledge receipt (but don't process)
      return NextResponse.json({ accepted: true }, { status: 200 });
    }

    // Read and parse body
    const body = await req.text();
    let payload: WeroWebhook;

    try {
      payload = JSON.parse(body) as WeroWebhook;
    } catch (err) {
      console.error('[wero-payments] Failed to parse webhook payload:', err);
      return NextResponse.json({ accepted: true }, { status: 200 });
    }

    // Validate signature
    const isValid = weroClient.verifySignature(body, signature);

    // Log webhook event (always, even if signature invalid)
    await logWebhookEvent(payload.paymentId, 'status_update', payload.status, payload, isValid, db);

    if (!isValid) {
      console.error('[wero-payments] Invalid webhook signature for payment:', payload.paymentId);
      return NextResponse.json({ accepted: true }, { status: 200 });
    }

    // Process webhook asynchronously (don't wait)
    handleWeroWebhook(payload, db).catch((err) => {
      console.error('[wero-payments] Failed to handle webhook:', err);
    });

    return NextResponse.json({ accepted: true }, { status: 200 });
  } catch (err) {
    console.error('[wero-payments] webhook error:', err);
    return NextResponse.json({ accepted: true }, { status: 200 });
  }
};
