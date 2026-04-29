import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

// ---------------------------------------------------------------------------
// POST /api/payments/stripe/wallet
// Create a wallet-compatible PaymentIntent for Apple Pay / Google Pay.
// Returns clientSecret for Stripe.js Payment Request Button.
// ---------------------------------------------------------------------------

const WalletCheckoutSchema = z.object({
  orderId: z.string().uuid(),
  userId: z.string().uuid(),
  currency: z.string().length(3).default('CZK'),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: z.infer<typeof WalletCheckoutSchema>;
  try {
    body = WalletCheckoutSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', details: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  try {
    // In production: inject real DB adapter from service container
    const { createWalletPaymentIntent } = await import('../../../../../services/wallet-pay.service.js');
    const { db } = await import('../../../../../lib/service-container.js' as any);

    const [order] = await db.query<{ amount_hellers: number; currency: string }>(
      `SELECT amount_hellers, currency FROM orders.orders WHERE id = $1 AND status = 'pending'`,
      [body.orderId],
    ).catch(() => [undefined]);

    if (!order) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 });
    }

    const result = await createWalletPaymentIntent(
      body.orderId,
      order.amount_hellers,
      order.currency ?? body.currency,
      { order_id: body.orderId, user_id: body.userId },
      db,
    );

    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('VALIDATION_ERROR')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error('[wallet-pay]', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET /api/payments/stripe/wallet
// Returns Stripe publishable key for frontend initialization.
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  try {
    const { getStripePublishableKey } = await import('../../../../../services/wallet-pay.service.js');
    const publishableKey = getStripePublishableKey();
    return NextResponse.json({ publishableKey }, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'CONFIG_MISSING' }, { status: 500 });
  }
}
