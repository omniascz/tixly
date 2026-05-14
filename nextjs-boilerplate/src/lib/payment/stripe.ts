/**
 * Stripe Checkout Sessions wrapper.
 *
 * Stripe-hosted page (mode='payment') zvládá 3DS, Apple/Google Pay, card auth.
 * Žádný Stripe SDK install — volá REST API přes fetch.
 *
 * Env:
 *   STRIPE_SECRET_KEY        sk_live_xxx / sk_test_xxx (server)
 *   STRIPE_PUBLISHABLE_KEY   pk_live_xxx / pk_test_xxx (client, nepoužíváno pro hosted checkout)
 *   STRIPE_WEBHOOK_SECRET    whsec_xxx (verifikace webhooku)
 *
 * Po dokončení platby Stripe redirectuje na success_url s ?session_id={CHECKOUT_SESSION_ID}.
 * Order se ale zaplatí až přes webhook (checkout.session.completed) — success_url je
 * jen UX redirect, ne autoritativní potvrzení.
 */

const STRIPE_API_URL = 'https://api.stripe.com/v1';

export interface StripeCheckoutInput {
  orderId: string;
  amountHalire: number;
  currency: string; // 'CZK', 'EUR', 'USD'
  buyerEmail: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  /** Pokud poskytneš, přidá idempotency-key header — bezpečný retry. */
  idempotencyKey?: string;
}

export interface StripeCheckoutResult {
  /** Stripe Checkout Session ID — uložit do orders.gopay_payment_id pro reference. */
  paymentId: string;
  /** Hosted checkout URL pro redirect. */
  gatewayUrl: string;
  /** Stripe PaymentIntent ID pro pozdější refund (po dokončení platby). */
  paymentIntentId: string | null;
}

function stripeFormBody(params: Record<string, string | number | boolean | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    usp.set(k, String(v));
  }
  return usp.toString();
}

async function stripeRequest<T>(
  path: string,
  body: string | undefined,
  opts: { method: 'GET' | 'POST'; idempotencyKey?: string } = { method: 'POST' },
): Promise<T> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('STRIPE_SECRET_KEY missing');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  const res = await fetch(`${STRIPE_API_URL}${path}`, {
    method: opts.method,
    headers,
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/**
 * Vytvoří Stripe Checkout Session. Vrací URL pro redirect kupujícího na Stripe-hosted page.
 *
 * Stripe accepts částky v "smallest currency unit" — pro CZK to jsou halíře, stejně jako my.
 */
export async function createStripeCheckoutSession(
  input: StripeCheckoutInput,
): Promise<StripeCheckoutResult> {
  const params: Record<string, string | number | boolean> = {
    mode: 'payment',
    success_url: `${input.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: input.cancelUrl,
    customer_email: input.buyerEmail,
    'metadata[orderId]': input.orderId,
    'payment_intent_data[metadata][orderId]': input.orderId,
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': input.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': input.amountHalire,
    'line_items[0][price_data][product_data][name]': input.description,
  };

  const session = await stripeRequest<{
    id: string;
    url: string;
    payment_intent: string | null;
  }>('/checkout/sessions', stripeFormBody(params), {
    method: 'POST',
    idempotencyKey: input.idempotencyKey,
  });

  return {
    paymentId: session.id,
    gatewayUrl: session.url,
    paymentIntentId: session.payment_intent,
  };
}

export async function createStripeRefund(input: {
  paymentIntentId: string;
  amountHalire?: number;
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
  idempotencyKey?: string;
}): Promise<{ id: string; status: string; amount: number }> {
  const params: Record<string, string | number> = {
    payment_intent: input.paymentIntentId,
  };
  if (input.amountHalire !== undefined) params.amount = input.amountHalire;
  if (input.reason) params.reason = input.reason;
  return stripeRequest('/refunds', stripeFormBody(params), {
    method: 'POST',
    idempotencyKey: input.idempotencyKey,
  });
}

/**
 * Verifikuje Stripe webhook signature pomocí HMAC SHA-256.
 * Stripe-Signature header format: "t=<timestamp>,v1=<signature>,..."
 *
 * Bez `STRIPE_WEBHOOK_SECRET` returnu false — webhook musí mít secret v prod.
 */
export async function verifyStripeWebhookSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  toleranceSeconds?: number;
}): Promise<{ ok: boolean; reason?: string }> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'no_webhook_secret' };
  if (!input.signatureHeader) return { ok: false, reason: 'no_signature_header' };

  const parts = input.signatureHeader.split(',').reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const timestamp = Number(parts['t']);
  const sig = parts['v1'];
  if (!timestamp || !sig) return { ok: false, reason: 'missing_timestamp_or_sig' };

  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(Date.now() / 1000 - timestamp) > tolerance) {
    return { ok: false, reason: 'timestamp_outside_tolerance' };
  }

  const { createHmac, timingSafeEqual } = await import('crypto');
  const payload = `${timestamp}.${input.rawBody}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');

  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return { ok: false, reason: 'sig_length_mismatch' };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: 'sig_mismatch' };

  return { ok: true };
}
