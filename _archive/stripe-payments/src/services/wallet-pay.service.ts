// =============================================================================
// Wallet Pay Service — Apple Pay & Google Pay via Stripe
// Feature #26: Digital wallet payments in checkout
//
// Architecture:
//   - Apple Pay: Stripe handles domain verification + payment sheet
//   - Google Pay: Stripe Payment Request Button (no server config needed)
//   - Both use Stripe PaymentIntents with payment_method_types: ['card', 'link']
//   - Apple Pay requires domain registration in Stripe dashboard
// =============================================================================

export interface WalletPaymentIntent {
  paymentIntentId: string;
  clientSecret: string;
  amount: number;
  currency: string;
  paymentMethods: Array<'card' | 'apple_pay' | 'google_pay' | 'link'>;
}

export interface ApplePayDomainRegistration {
  domain: string;
  registered: boolean;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

/**
 * Create a PaymentIntent with wallet-compatible payment methods.
 * Stripe automatically enables Apple Pay and Google Pay when
 * `automatic_payment_methods: { enabled: true }` is set.
 */
export async function createWalletPaymentIntent(
  orderId: string,
  amountHellers: number,
  currency: string,
  metadata: Record<string, string>,
  db: DbAdapter,
): Promise<WalletPaymentIntent> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_KEY_MISSING');

  if (amountHellers <= 0) {
    throw new Error('VALIDATION_ERROR: amount must be positive');
  }

  const body = new URLSearchParams({
    amount: String(amountHellers),
    currency: currency.toLowerCase(),
    'automatic_payment_methods[enabled]': 'true',
    // This enables Apple Pay and Google Pay automatically
    'automatic_payment_methods[allow_redirects]': 'never',
    ...Object.fromEntries(
      Object.entries(metadata).map(([k, v]) => [`metadata[${k}]`, v]),
    ),
  });

  const response = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const err = await response.json() as { error?: { message?: string } };
    throw new Error(`STRIPE_ERROR: ${err.error?.message ?? 'Unknown error'}`);
  }

  const result = await response.json() as {
    id: string;
    client_secret: string;
    amount: number;
    currency: string;
    payment_method_types: string[];
  };

  // Persist intent ID
  await db.execute(
    `UPDATE orders.orders
     SET stripe_payment_intent_id = $1, payment_provider = 'stripe'
     WHERE id = $2`,
    [result.id, orderId],
  );

  await db.execute(
    `INSERT INTO orders.payment_events
       (order_id, event_type, payment_provider, amount_hellers, raw_payload)
     VALUES ($1, 'wallet_payment_intent.created', 'stripe', $2, $3)`,
    [orderId, amountHellers, JSON.stringify({ paymentIntentId: result.id })],
  );

  return {
    paymentIntentId: result.id,
    clientSecret: result.client_secret,
    amount: result.amount,
    currency: result.currency,
    paymentMethods: ['card', 'apple_pay', 'google_pay'],
  };
}

/**
 * Register a domain for Apple Pay via Stripe API.
 * Must be called once per domain during setup.
 * Production domains: tixly.io, *.tixly.io
 */
export async function registerApplePayDomain(
  domain: string,
): Promise<ApplePayDomainRegistration> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_KEY_MISSING');

  if (!domain || !domain.includes('.')) {
    throw new Error('VALIDATION_ERROR: invalid domain');
  }

  const body = new URLSearchParams({ domain_name: domain });

  const response = await fetch('https://api.stripe.com/v1/apple_pay/domains', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const err = await response.json() as { error?: { message?: string } };
    // Domain already registered is not a fatal error
    if (response.status === 400 && err.error?.message?.includes('already')) {
      return { domain, registered: true };
    }
    throw new Error(`APPLE_PAY_REGISTRATION_FAILED: ${err.error?.message}`);
  }

  return { domain, registered: true };
}

/**
 * Get Stripe publishable key for frontend initialization.
 * Safe to expose to client — used to initialize Stripe.js.
 */
export function getStripePublishableKey(): string {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!key) throw new Error('STRIPE_PUBLISHABLE_KEY not set');
  return key;
}

/**
 * Verify Apple Pay merchant session (required by Apple's JS API).
 * Proxies the request to Stripe's Apple Pay merchant validation endpoint.
 */
export async function validateApplePayMerchant(
  validationUrl: string,
  domainName: string,
  displayName: string = 'Tixly',
): Promise<unknown> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_KEY_MISSING');

  if (!validationUrl.startsWith('https://')) {
    throw new Error('VALIDATION_ERROR: validationUrl must be https');
  }

  const body = new URLSearchParams({
    validation_url: validationUrl,
    domain_name: domainName,
    display_name: displayName,
  });

  const response = await fetch('https://api.stripe.com/v1/apple_pay/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const err = await response.json() as { error?: { message?: string } };
    throw new Error(`APPLE_PAY_SESSION_FAILED: ${err.error?.message}`);
  }

  return response.json();
}
