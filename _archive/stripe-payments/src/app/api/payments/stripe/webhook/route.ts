import { NextRequest, NextResponse } from 'next/server';
import { handleStripeWebhook } from '../../../../../services/stripe.service';
import { isStripeError } from '../../../../../lib/stripe-errors';
import type { StripeDeps } from '../../../../../lib/service-container';

// ---------------------------------------------------------------------------
// POST /api/payments/stripe/webhook
//
// Přijímá Stripe webhook events.
// VŽDY vrací 200 — Stripe opakuje doručení při non-200.
// Chyby jsou logovány, nikdy nevraceny jako non-200.
//
// Ověřuje Stripe-Signature HMAC-SHA256 hlavičku.
// Idempotency: duplikátní eventy jsou tiše přeskočeny.
// ---------------------------------------------------------------------------

// Dependency factory — v produkci nahrazena skutečnými adaptéry
function getDeps(): StripeDeps {
  throw new Error('getDeps() must be replaced with real DB adapter in production.');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature') ?? '';

  if (!signature) {
    // Logovat ale vrátit 200 — mohlo by být testovací volání
    console.warn('[stripe-webhook] Missing Stripe-Signature header.');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  let deps: StripeDeps;
  try {
    deps = getDeps();
  } catch {
    console.error('[stripe-webhook] getDeps() failed — service unavailable.');
    // Vrátit 200 aby Stripe neopakoval (konfigurace chyba, ne transakční)
    return NextResponse.json({ received: true }, { status: 200 });
  }

  try {
    await handleStripeWebhook(rawBody, signature, deps);
  } catch (err) {
    if (isStripeError(err)) {
      // DUPLICATE_EVENT a INVALID_WEBHOOK_SIGNATURE — logovat na různé úrovně
      if (err.code === 'DUPLICATE_EVENT') {
        console.info('[stripe-webhook] Duplicate event — skipping (idempotency).');
      } else if (err.code === 'INVALID_WEBHOOK_SIGNATURE') {
        console.warn('[stripe-webhook] Invalid webhook signature — ignoring event.');
      } else {
        console.error('[stripe-webhook] StripeError:', err.code, err.message);
      }
    } else {
      // Neočekávaná chyba — logovat a nadále vrátit 200
      console.error('[stripe-webhook] Unexpected error:', err);
    }
  }

  // VŽDY 200 — Stripe považuje vše ostatní za chybu doručení a opakuje
  return NextResponse.json({ received: true }, { status: 200 });
}
