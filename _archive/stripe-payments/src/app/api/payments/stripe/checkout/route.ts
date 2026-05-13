import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { createPaymentIntent } from '../../../../../services/stripe.service';
import { isStripeError } from '../../../../../lib/stripe-errors';
import type { StripeDeps } from '../../../../../lib/service-container';

// ---------------------------------------------------------------------------
// POST /api/payments/stripe/checkout
//
// Body: { orderId: string, userId: string }
// Ověří stav objednávky = pending, vytvoří Stripe PaymentIntent.
// Vrátí { clientSecret, paymentIntentId }.
// ---------------------------------------------------------------------------

const StripeCheckoutSchema = z.object({
  orderId: z.string().uuid({ message: 'orderId musí být platné UUID.' }),
  userId: z.string().uuid({ message: 'userId musí být platné UUID.' }),
});

// Dependency factory — v produkci nahrazena skutečnými adaptéry
function getDeps(): StripeDeps {
  // V produkci import ze sdíleného service-containeru
  throw new Error('getDeps() must be replaced with real DB adapter in production.');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: z.infer<typeof StripeCheckoutSchema>;
  try {
    const raw = await request.json();
    body = StripeCheckoutSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Neplatná data požadavku.', details: err.errors },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Neplatný JSON.' }, { status: 400 });
  }

  const { orderId, userId: _userId } = body;

  let deps: StripeDeps;
  try {
    deps = getDeps();
  } catch {
    return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });
  }

  // Načíst objednávku a ověřit stav = pending
  const [order] = await deps.db.query<{ id: string; status: string; amount_hellers: number; currency: string }>(
    'SELECT id, status, amount_hellers, currency FROM orders.orders WHERE id = $1',
    [orderId],
  ).catch(() => [undefined]);

  if (!order) {
    return NextResponse.json({ error: 'ORDER_NOT_FOUND', message: 'Order not found.' }, { status: 404 });
  }

  if (order.status !== 'pending') {
    if (order.status === 'paid') {
      return NextResponse.json({ error: 'ALREADY_PAID', message: 'This order has already been paid.' }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'INVALID_ORDER_STATUS', message: `Order status is '${order.status}', expected 'pending'.` },
      { status: 409 },
    );
  }

  try {
    const result = await createPaymentIntent(
      {
        orderId,
        amountHellers: order.amount_hellers,
        currency: order.currency ?? 'czk',
        metadata: { userId: _userId },
      },
      deps,
    );

    return NextResponse.json(
      { clientSecret: result.clientSecret, paymentIntentId: result.paymentIntentId },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (err) {
    if (isStripeError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    console.error('[stripe-checkout] Unexpected error:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Internal server error.' }, { status: 500 });
  }
}
