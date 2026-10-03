/**
 * PayPal Orders API v2 client.
 *
 * Flow:
 *   1. createPayPalOrder()  → approveUrl (redirect buyer to PayPal)
 *   2. Buyer approves       → PayPal redirects to returnUrl?token=PAYPAL_ORDER_ID
 *   3. capturePayPalOrder() → COMPLETED (mark order paid)
 *
 * Also supports PAYMENT.CAPTURE.COMPLETED webhook for double-confirmation.
 *
 * Docs: https://developer.paypal.com/docs/api/orders/v2/
 *
 * Env:
 *   PAYPAL_CLIENT_ID      — App client ID
 *   PAYPAL_CLIENT_SECRET  — App client secret
 *   PAYPAL_SANDBOX=1      — use sandbox (api-m.sandbox.paypal.com)
 *   PAYPAL_WEBHOOK_ID     — webhook ID from PayPal developer dashboard (for signature verification)
 */

import { createHmac, timingSafeEqual } from 'crypto';

// PAYPAL_API_BASE_URL přepíše cíl (testy proti simulátoru); čte se při každém volání.
const base = (): string => process.env.PAYPAL_API_BASE_URL
  ?? (process.env.PAYPAL_SANDBOX === '1' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com');

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  isConfigured: boolean;
}

export function getPayPalConfig(): PayPalConfig {
  const clientId = process.env.PAYPAL_CLIENT_ID ?? '';
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? '';
  const webhookId = process.env.PAYPAL_WEBHOOK_ID ?? '';
  return { clientId, clientSecret, webhookId, isConfigured: !!clientId && !!clientSecret };
}

let _tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now + 30_000) {
    return _tokenCache.token;
  }

  const cfg = getPayPalConfig();
  const creds = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal auth HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  _tokenCache = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return data.access_token;
}

export interface PayPalOrderInput {
  orderId: string;
  /** Decimal string e.g. "12.50" */
  amountValue: string;
  currency: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  locale?: string;
}

export async function createPayPalOrder(
  input: PayPalOrderInput,
): Promise<{ paypalOrderId: string; approveUrl: string }> {
  const token = await getAccessToken();

  const body = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: input.orderId,
        description: input.description.slice(0, 127),
        amount: {
          currency_code: input.currency,
          value: input.amountValue,
        },
      },
    ],
    application_context: {
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl,
      brand_name: 'Tixly',
      locale: input.locale ?? 'en-GB',
      user_action: 'PAY_NOW',
      shipping_preference: 'NO_SHIPPING',
    },
  };

  const res = await fetch(`${base()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': input.orderId,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal create order HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json() as {
    id: string;
    links: Array<{ rel: string; href: string }>;
  };

  const approveUrl = data.links.find((l) => l.rel === 'approve')?.href ?? '';
  return { paypalOrderId: data.id, approveUrl };
}

export interface PayPalCaptureResult {
  captured: boolean;
  tixlyOrderId: string;
  amountValue: string;
  currency: string;
  paypalCaptureId: string;
}

export async function capturePayPalOrder(
  paypalOrderId: string,
): Promise<PayPalCaptureResult> {
  const token = await getAccessToken();

  const res = await fetch(`${base()}/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal capture HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json() as {
    id: string;
    status: string;
    purchase_units: Array<{
      reference_id: string;
      payments: {
        captures: Array<{
          id: string;
          amount: { value: string; currency_code: string };
          status: string;
        }>;
      };
    }>;
  };

  const unit = data.purchase_units[0];
  const capture = unit?.payments?.captures?.[0];

  return {
    captured: data.status === 'COMPLETED' && capture?.status === 'COMPLETED',
    tixlyOrderId: unit?.reference_id ?? '',
    amountValue: capture?.amount.value ?? '0',
    currency: capture?.amount.currency_code ?? '',
    paypalCaptureId: capture?.id ?? '',
  };
}

/**
 * Verify PayPal webhook signature via PayPal REST API (server-side verification).
 * Requires PAYPAL_WEBHOOK_ID env variable.
 */
export async function verifyPayPalWebhookSignature(input: {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
  rawBody: string;
}): Promise<boolean> {
  const cfg = getPayPalConfig();
  if (!cfg.webhookId) return false;

  try {
    const token = await getAccessToken();
    const res = await fetch(`${base()}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transmission_id: input.transmissionId,
        transmission_time: input.transmissionTime,
        cert_url: input.certUrl,
        auth_algo: input.authAlgo,
        transmission_sig: input.transmissionSig,
        webhook_id: cfg.webhookId,
        webhook_event: JSON.parse(input.rawBody) as unknown,
      }),
    });
    if (!res.ok) return false;
    const data = await res.json() as { verification_status: string };
    return data.verification_status === 'SUCCESS';
  } catch {
    return false;
  }
}

/**
 * Kolo 2: autoritativní stav PayPal objednávky z REST API (GET /v2/checkout/orders/{id}).
 * Webhook podle něj (ne podle obsahu notifikace) rozhoduje o `paid`.
 * Vrací součet COMPLETED capture v minor units (halíře/centy) a jejich měnu.
 */
export async function getPayPalOrder(paypalOrderId: string): Promise<{
  status: string;
  referenceId: string;
  completedMinor: number;
  currency: string;
}> {
  const token = await getAccessToken();
  const res = await fetch(`${base()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`PayPal GET order HTTP ${res.status}`);
  const data = await res.json() as {
    status?: string;
    purchase_units?: Array<{ reference_id?: string; payments?: { captures?: Array<{ status?: string; amount?: { value?: string; currency_code?: string } }> } }>;
  };
  const unit = data.purchase_units?.[0];
  const done = (unit?.payments?.captures ?? []).filter((c) => c.status === 'COMPLETED');
  return {
    status: data.status ?? '',
    referenceId: unit?.reference_id ?? '',
    completedMinor: done.reduce((a, c) => a + Math.round(parseFloat(c.amount?.value ?? '0') * 100), 0),
    currency: done[0]?.amount?.currency_code ?? '',
  };
}

/** Refund a captured PayPal payment. */
export async function refundPayPalCapture(params: {
  captureId: string;
  amountValue?: string;
  currency?: string;
  idempotencyKey: string;
}): Promise<{ id: string; status: string }> {
  const token = await getAccessToken();

  const body: Record<string, unknown> = {};
  if (params.amountValue && params.currency) {
    body.amount = { value: params.amountValue, currency_code: params.currency };
  }

  const res = await fetch(`${base()}/v2/payments/captures/${params.captureId}/refund`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': params.idempotencyKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal refund HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<{ id: string; status: string }>;
}

/** Extract HMAC CRC32 for PayPal IPN-style verification (legacy, fallback). */
export function verifyPayPalIpnHmac(params: {
  rawBody: string;
  secret: string;
  signature: string;
}): boolean {
  const expected = createHmac('sha256', params.secret)
    .update(params.rawBody)
    .digest('hex');
  const a = Buffer.from(params.signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
