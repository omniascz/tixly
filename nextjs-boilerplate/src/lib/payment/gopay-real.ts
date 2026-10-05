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
import { assertStagingIsolated } from '@/lib/env/staging-guard';

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
  assertStagingIsolated(); // kolo 9: staging nikdy nepoužije ostrou bránu

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
  // Kolo 7: `payment-all` — podle doc.gopay.com token se scope `payment-create` smí JEN zakládat
  // platby; tentýž token se ale používá i na dotaz na stav (webhook) a refund → u skutečné brány 403.
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'payment-all',
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
  allow_card_store?: boolean;
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
    ...(input.allow_card_store
      ? { additional_params: [{ name: 'allow_card_store', value: 'true' }] }
      : {}),
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
    // SECURITY: v PRODUKCI nesmí nenakonfigurované GoPay vrátit paid:true —
    // jinak by útočník přes webhook označil objednávku zaplacenou bez platby.
    // Fail-closed → throw (webhook to chytí a vrátí 502, objednávka zůstane pending).
    if (process.env.NODE_ENV === 'production') {
      throw new Error('GoPay not configured in production — refusing DEV_STUB paid status');
    }
    // Dev only: v mock režimu předpokládáme paid (mock-gopay flow označí status v DB)
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
  // FIX K2: refund fetch měl nekonečné čekání — když brána neodpoví (výpadek),
  // refund by visel navždy a objednávka by zůstala v refund_pending bez rozhodnutí.
  // Timeout (konfigurovatelný) → AbortError → volající nastaví refund_failed a lze retry.
  const timeoutMs = Number(process.env.GOPAY_REFUND_TIMEOUT_MS ?? 20000);
  let res: Response;
  try {
    res = await fetch(
      `${config.apiBaseUrl}/payments/payment/${encodeURIComponent(paymentId)}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ amount: String(amountHalire) }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  } catch (err) {
    // AbortError (timeout) nebo síťová chyba → refund NENÍ potvrzen.
    return { ok: false, raw: { error: err instanceof Error ? err.name + ': ' + err.message : String(err) } };
  }

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
