import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { getSeasonPassService } from '../../../../lib/service-registry';

// =============================================================================
// GoPay webhook — pass payments (initial purchase + recurring renewals)
// =============================================================================

interface GopayWebhookPayload {
  id: string;
  order_number: string; // maps to our passId
  state: 'CREATED' | 'PAYMENT_METHOD_CHOSEN' | 'PAID' | 'CANCELED' | 'TIMEOUTED' | 'AUTHORIZED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
  amount: number;
  currency: string;
  recurrences?: {
    recurrence_cycle: string;
    recurrence_state: 'REQUESTED' | 'ACTIVE' | 'STOPPED';
    next_recurrence_on?: string;
  };
  /** Present when the initial recurrent payment is PAID — used for future ON_DEMAND charges. */
  recurring_token?: string;
  /** Identifies this as a renewal charge rather than first payment. */
  parent_id?: string;
}

function verifyGopayHmac(rawBody: string, signatureHeader: string, secret: string): boolean {
  const expected = createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');
  const received = Buffer.from(signatureHeader, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (received.length !== expectedBuf.length) return false;
  return timingSafeEqual(received, expectedBuf);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();

  const signatureHeader = request.headers.get('x-gopay-signature') ?? '';
  const webhookSecret = process.env.GOPAY_WEBHOOK_SECRET ?? '';

  if (!webhookSecret) {
    console.error('[gopay-callback] GOPAY_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }

  // Reject requests with invalid HMAC signature
  if (!verifyGopayHmac(rawBody, signatureHeader, webhookSecret)) {
    return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 });
  }

  let payload: GopayWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as GopayWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  if (payload.state !== 'PAID') {
    // GoPay sends webhooks for all state transitions; only act on PAID
    return NextResponse.json({ received: true });
  }

  const service = getSeasonPassService();
  const passId = payload.order_number;

  try {
    if (payload.parent_id) {
      // This is a renewal charge (ON_DEMAND recurrent payment)
      await service.handleRenewalCallback(passId, payload.id);
    } else {
      // Initial purchase — activate the pass and persist recurring token if present
      await service.activatePass(passId, payload.id, payload.recurring_token);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[gopay-callback] Processing failed', { passId, message });
    // Return 200 to prevent GoPay from retrying; log the error for manual review
    return NextResponse.json({ received: true, warning: message });
  }

  return NextResponse.json({ received: true });
}
