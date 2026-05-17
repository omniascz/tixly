/**
 * ComGate REST API client — produkční implementace pro CZ + SK.
 *
 * ComGate API v2: https://help.comgate.cz/v2/docs/api-protocol
 * Endpoint: https://payments.comgate.cz/v2.0
 * Auth: basic auth s merchant + secret
 *
 * ENV:
 *   COMGATE_MERCHANT  — merchant ID (alfanumerický)
 *   COMGATE_SECRET    — API secret
 *   COMGATE_TEST=true — test mode
 *
 * Reference: https://help.comgate.cz/v2/docs/payment-create
 */

export interface ComGateConfig {
  merchant: string;
  secret: string;
  apiBaseUrl: string;
  test: boolean;
  isConfigured: boolean;
}

let warningLogged = false;
let cachedConfig: ComGateConfig | null = null;

export function getComGateConfig(): ComGateConfig {
  if (cachedConfig) return cachedConfig;

  const merchant = process.env.COMGATE_MERCHANT ?? '';
  const secret = process.env.COMGATE_SECRET ?? '';
  const test = process.env.COMGATE_TEST === 'true';
  const apiBaseUrl =
    process.env.COMGATE_API_BASE_URL ?? 'https://payments.comgate.cz/v2.0';

  const isConfigured = !!merchant && !!secret;

  if (!isConfigured && !warningLogged) {
    // eslint-disable-next-line no-console
    console.warn(
      '[payment] ComGate není nakonfigurovaný — checkout poběží v mock režimu. ' +
        'Nastavte COMGATE_MERCHANT, COMGATE_SECRET.',
    );
    warningLogged = true;
  }

  cachedConfig = { merchant, secret, apiBaseUrl, test, isConfigured };
  return cachedConfig;
}

function authHeader(config: ComGateConfig): string {
  const basicAuth = Buffer.from(`${config.merchant}:${config.secret}`, 'utf8').toString('base64');
  return `Basic ${basicAuth}`;
}

export interface ComGateCreateInput {
  orderId: string;
  amountHalire: number;
  currency: string;
  buyerEmail: string;
  buyerName?: string;
  description: string;
  notificationUrl: string;
  returnUrl: string;
}

export interface ComGateCreateResult {
  paymentId: string; // transId v ComGate terminologii
  gatewayUrl: string;
}

export async function createComGateSession(
  input: ComGateCreateInput,
): Promise<ComGateCreateResult> {
  const config = getComGateConfig();
  if (!config.isConfigured) {
    // Dev fallback
    return {
      paymentId: `comgate-dev-${input.orderId}`,
      gatewayUrl: `/mock-gopay/${input.orderId}`,
    };
  }

  // ComGate API očekává amount v haléřích/centech (= naše interní jednotka)
  const payload = {
    type: 'capture' as const,
    country: input.currency === 'EUR' ? 'SK' : 'CZ',
    price: input.amountHalire,
    currency: input.currency,
    label: input.description.slice(0, 255),
    refId: input.orderId,
    email: input.buyerEmail,
    ...(input.buyerName ? { name: input.buyerName.slice(0, 255) } : {}),
    method: 'ALL', // všechny dostupné metody (karta, GPay, ApplePay, BankTransfer)
    prepareOnly: false,
    test: config.test,
    lang: input.currency === 'EUR' ? 'sk' : 'cs',
    payerId: input.orderId, // pro buyer tracking
  };

  const res = await fetch(`${config.apiBaseUrl}/payment`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(config),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ComGate createPayment HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as { transId: string; redirect: string };
  return {
    paymentId: json.transId,
    gatewayUrl: json.redirect,
  };
}

export interface ComGateStatusResult {
  state: string;
  paid: boolean;
  refunded: boolean;
  amountHalire: number;
  currency: string;
}

export async function getComGatePaymentStatus(
  paymentId: string,
): Promise<ComGateStatusResult> {
  const config = getComGateConfig();
  if (!config.isConfigured) {
    return { state: 'DEV_STUB', paid: true, refunded: false, amountHalire: 0, currency: 'CZK' };
  }

  const res = await fetch(
    `${config.apiBaseUrl}/payment/transaction/${encodeURIComponent(paymentId)}`,
    {
      method: 'GET',
      headers: { Authorization: authHeader(config), Accept: 'application/json' },
    },
  );
  if (!res.ok) throw new Error(`ComGate getPayment HTTP ${res.status}`);

  const json = (await res.json()) as {
    state: string;
    price: number;
    currency: string;
  };
  // ComGate states: PENDING | AUTHORIZED | PAID | CANCELLED | REFUNDED | TIMEOUTED
  return {
    state: json.state,
    paid: json.state === 'PAID',
    refunded: json.state === 'REFUNDED',
    amountHalire: json.price,
    currency: json.currency,
  };
}

export async function refundComGatePayment(
  paymentId: string,
  amountHalire: number,
): Promise<{ ok: boolean; raw: unknown }> {
  const config = getComGateConfig();
  if (!config.isConfigured) {
    return { ok: true, raw: 'DEV_STUB' };
  }

  const res = await fetch(
    `${config.apiBaseUrl}/payment/transaction/${encodeURIComponent(paymentId)}/refund`,
    {
      method: 'POST',
      headers: {
        Authorization: authHeader(config),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ amount: amountHalire }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, raw: { status: res.status, body: text } };
  }
  const json = await res.json().catch(() => ({}));
  return { ok: res.status >= 200 && res.status < 300, raw: json };
}

/** Pro testy. */
export function _resetComGateCacheForTests(): void {
  cachedConfig = null;
  warningLogged = false;
}
