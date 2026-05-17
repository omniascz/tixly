/**
 * GoPay REST API client — produkční implementace.
 *
 * OAuth2 client_credentials flow + payment-create. Pokud chybí jakýkoli povinný
 * ENV → isConfigured=false a createGopaySession vrátí mock URL (dev režim).
 *
 * ENV:
 *   GOPAY_GOID                — Tixly merchant ID (číslo)
 *   GOPAY_CLIENT_ID           — OAuth client ID
 *   GOPAY_CLIENT_SECRET       — OAuth client secret
 *   GOPAY_SANDBOX=true|false  — pokud true, použij sandbox URL
 *   GOPAY_API_BASE_URL        — explicit override base URL
 *
 * Reference: https://doc.gopay.com/#payment-creation
 */

export interface GopayConfig {
  goid: number;
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;
  isConfigured: boolean;
}

let warningLogged = false;
let cachedConfig: GopayConfig | null = null;

export function getGopayConfig(): GopayConfig {
  if (cachedConfig) return cachedConfig;

  const goidRaw = process.env.GOPAY_GOID ?? '';
  const clientId = process.env.GOPAY_CLIENT_ID ?? '';
  const clientSecret = process.env.GOPAY_CLIENT_SECRET ?? '';
  const sandbox = process.env.GOPAY_SANDBOX === 'true';
  const apiBaseUrl =
    process.env.GOPAY_API_BASE_URL ??
    (sandbox ? 'https://gw.sandbox.gopay.com/api' : 'https://gate.gopay.cz/api');

  const goid = Number.parseInt(goidRaw, 10);
  const isConfigured =
    !!goidRaw && !Number.isNaN(goid) && goid > 0 && !!clientId && !!clientSecret;

  if (!isConfigured && !warningLogged) {
    // eslint-disable-next-line no-console
    console.warn(
      '[payment] GoPay není nakonfigurovaný — checkout poběží v mock režimu. ' +
        'Nastavte GOPAY_GOID, GOPAY_CLIENT_ID, GOPAY_CLIENT_SECRET.',
    );
    warningLogged = true;
  }

  cachedConfig = {
    goid: Number.isNaN(goid) ? 0 : goid,
    clientId,
    clientSecret,
    apiBaseUrl,
    isConfigured,
  };
  return cachedConfig;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}
let cachedToken: CachedToken | null = null;

async function getAccessToken(config: GopayConfig): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - now > 60_000) {
    return cachedToken.token;
  }

  const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`, 'utf8').toString(
    'base64',
  );
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'payment-create',
  }).toString();

  const res = await fetch(`${config.apiBaseUrl}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  if (!res.ok) throw new Error(`GoPay OAuth selhalo: HTTP ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('GoPay nevrátilo access_token');

  cachedToken = {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 1800) * 1000,
  };
  return json.access_token;
}

export interface GopayCreateInput {
  orderId: string;
  amountHalire: number;
  currency: string;
  buyerEmail: string;
  buyerName?: string;
  description: string;
  notificationUrl: string;
  returnUrl: string;
}

export interface GopayCreateResult {
  paymentId: string;
  gatewayUrl: string;
}

export async function createGopaySession(input: GopayCreateInput): Promise<GopayCreateResult> {
  const config = getGopayConfig();
  if (!config.isConfigured) {
    // Dev fallback — přesměruje na lokální mock UI
    return {
      paymentId: `gopay-dev-${input.orderId}`,
      gatewayUrl: `/mock-gopay/${input.orderId}`,
    };
  }

  const token = await getAccessToken(config);
  const payload = {
    payer: {
      default_payment_instrument: 'PAYMENT_CARD',
      allowed_payment_instruments: [
        'PAYMENT_CARD',
        'BANK_ACCOUNT',
        'GPAY',
        'APPLE_PAY',
      ],
      contact: {
        email: input.buyerEmail,
        ...(input.buyerName ? { first_name: input.buyerName.split(' ')[0] ?? '' } : {}),
      },
    },
    target: { type: 'ACCOUNT', goid: config.goid },
    amount: input.amountHalire,
    currency: input.currency,
    order_number: input.orderId,
    order_description: input.description.slice(0, 256),
    callback: {
      return_url: input.returnUrl,
      notification_url: input.notificationUrl,
    },
    lang: input.currency === 'EUR' ? 'SK' : 'CS',
  };

  const res = await fetch(`${config.apiBaseUrl}/payments/payment`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GoPay createPayment HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as { id: number | string; gw_url: string };
  return {
    paymentId: String(json.id),
    gatewayUrl: json.gw_url,
  };
}

export interface GopayStatusResult {
  state: string;
  paid: boolean;
  refunded: boolean;
  amountHalire: number;
  currency: string;
}

export async function getGopayPaymentStatus(paymentId: string): Promise<GopayStatusResult> {
  const config = getGopayConfig();
  if (!config.isConfigured) {
    // Dev: v mock režimu předpokládáme paid (mock-gopay flow označí status v DB)
    return { state: 'DEV_STUB', paid: true, refunded: false, amountHalire: 0, currency: 'CZK' };
  }

  const token = await getAccessToken(config);
  const res = await fetch(
    `${config.apiBaseUrl}/payments/payment/${encodeURIComponent(paymentId)}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    },
  );
  if (!res.ok) throw new Error(`GoPay getPayment HTTP ${res.status}`);

  const json = (await res.json()) as {
    state: string;
    amount: number;
    currency: string;
  };
  return {
    state: json.state,
    paid: json.state === 'PAID',
    refunded: json.state === 'REFUNDED' || json.state === 'PARTIALLY_REFUNDED',
    amountHalire: json.amount,
    currency: json.currency,
  };
}

export async function refundGopayPayment(
  paymentId: string,
  amountHalire: number,
): Promise<{ ok: boolean; raw: unknown }> {
  const config = getGopayConfig();
  if (!config.isConfigured) {
    return { ok: true, raw: 'DEV_STUB' };
  }

  const token = await getAccessToken(config);
  const res = await fetch(
    `${config.apiBaseUrl}/payments/payment/${encodeURIComponent(paymentId)}/refund`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ amount: String(amountHalire) }).toString(),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, raw: { status: res.status, body: text } };
  }
  const json = (await res.json()) as { result?: string };
  return { ok: json.result === 'FINISHED' || json.result === 'CREATED', raw: json };
}

/** Pro testy — vyčistit cache. */
export function _resetGopayCacheForTests(): void {
  cachedConfig = null;
  cachedToken = null;
  warningLogged = false;
}
