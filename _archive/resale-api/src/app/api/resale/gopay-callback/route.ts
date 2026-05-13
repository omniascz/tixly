import { NextRequest, NextResponse } from 'next/server';
import { InvalidWebhookSignatureError } from '../../../../lib/resale-errors';
import { getServiceContainer } from '../../../../lib/service-container';

// ---------------------------------------------------------------------------
// POST /api/resale/gopay-callback — GoPay webhook
//
// GoPay retries delivery on any non-200 response, so this handler ALWAYS
// returns 200 even on internal errors. Errors are logged for investigation.
// ---------------------------------------------------------------------------

interface GopayWebhookBody {
  id: string;
  state: string;
  [key: string]: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  const signature = request.headers.get('X-GoPay-Signature') ?? '';

  const { gopay, resaleListingService } = getServiceContainer();

  // Verify HMAC signature to prevent spoofed webhook calls
  if (!gopay.verifyHmacSignature(rawBody, signature)) {
    // Log the rejection but still return 200 so GoPay doesn't keep retrying a forged request
    console.warn('[gopay-callback] Invalid HMAC signature — ignoring webhook');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  let body: GopayWebhookBody;
  try {
    body = JSON.parse(rawBody) as GopayWebhookBody;
  } catch {
    console.error('[gopay-callback] Failed to parse webhook body');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  try {
    await resaleListingService.handleGopayCallback(body.id, body.state);
  } catch (err) {
    // Internal errors must not cause a non-200 — GoPay would retry indefinitely
    console.error('[gopay-callback] handleGopayCallback threw:', err);
  }

  // Always 200 — GoPay considers anything else a delivery failure and retries
  return NextResponse.json({ received: true }, { status: 200 });
}
