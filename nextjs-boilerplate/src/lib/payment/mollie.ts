/**
 * Mollie Payments API v2 client.
 *
 * Covers: iDEAL (NL), Bancontact (BE), PayPal, Klarna, SEPA Direct Debit,
 *         Apple Pay, Przelewy24, BLIK, SOFORT, Giropay + more.
 *
 * Docs: https://docs.mollie.com/reference/payments-api
 *
 * Env:
 *   MOLLIE_API_KEY   — Live: live_xxx  /  Test: test_xxx
 */

// MOLLIE_API_BASE_URL přepíše cíl (testy proti simulátoru); čte se při každém volání.
const mollieApi = (): string => process.env.MOLLIE_API_BASE_URL ?? 'https://api.mollie.com/v2';

export type MollieMethod =
  | 'ideal'
  | 'bancontact'
  | 'paypal'
  | 'klarna'
  | 'applepay'
  | 'googlepay'
  | 'sepadirectdebit'
  | 'sofort'
  | 'przelewy24'
  | 'blik'
  | 'eps'
  | 'giropay'
  | 'creditcard';

export interface MollieConfig {
  apiKey: string;
  isConfigured: boolean;
}

export function getMollieConfig(): MollieConfig {
  const apiKey = process.env.MOLLIE_API_KEY ?? '';
  return { apiKey, isConfigured: !!apiKey };
}

export interface MollieCreateInput {
  orderId: string;
  /** Decimal string e.g. "12.50" */
  amountValue: string;
  currency: string;
  buyerEmail: string;
  description: string;
  method?: MollieMethod;
  locale?: string;
  redirectUrl: string;
  webhookUrl: string;
}

export async function createMolliePayment(
  input: MollieCreateInput,
): Promise<{ id: string; checkoutUrl: string }> {
  const cfg = getMollieConfig();

  const body: Record<string, unknown> = {
    amount: { value: input.amountValue, currency: input.currency },
    description: input.description,
    redirectUrl: input.redirectUrl,
    webhookUrl: input.webhookUrl,
    metadata: { orderId: input.orderId },
    locale: input.locale ?? 'en_US',
  };
  if (input.method) body.method = input.method;

  const res = await fetch(`${mollieApi()}/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mollie create HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json() as {
    id: string;
    _links: {
      checkout?: { href: string };
      paymentUrl?: { href: string };
    };
  };

  return {
    id: data.id,
    checkoutUrl: data._links.checkout?.href ?? data._links.paymentUrl?.href ?? '',
  };
}

export interface MolliePayment {
  id: string;
  status: 'open' | 'canceled' | 'pending' | 'authorized' | 'expired' | 'failed' | 'paid';
  amount: { value: string; currency: string };
  metadata: { orderId?: string } | null;
  paidAt?: string;
}

export async function getMolliePayment(paymentId: string): Promise<MolliePayment> {
  const cfg = getMollieConfig();
  const res = await fetch(`${mollieApi()}/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  });
  if (!res.ok) {
    // httpStatus nese důvod (404 = platba u Mollie neexistuje → webhook odpoví 4xx, ne 5xx)
    throw Object.assign(new Error(`Mollie GET ${paymentId} → HTTP ${res.status}`), { httpStatus: res.status });
  }
  return res.json() as Promise<MolliePayment>;
}

export async function refundMolliePayment(params: {
  paymentId: string;
  amountValue: string;
  currency: string;
  idempotencyKey: string;
}): Promise<{ id: string; status: string }> {
  const cfg = getMollieConfig();
  const res = await fetch(`${mollieApi()}/payments/${params.paymentId}/refunds`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': params.idempotencyKey,
    },
    body: JSON.stringify({
      amount: { value: params.amountValue, currency: params.currency },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mollie refund HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<{ id: string; status: string }>;
}
