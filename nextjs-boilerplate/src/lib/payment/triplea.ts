/**
 * Triple-A crypto payment client — produkční implementace.
 *
 * Triple-A = stablecoin/crypto platební brána (Bitcoin/stablecoiny). OAuth2
 * client_credentials → create payment (hosted redirect form) → webhook potvrdí
 * platbu on-chain. Pokud chybí ENV → isConfigured=false a checkout spadne na
 * mock (jen mimo produkci; v produkci fail-closed přes mock-guard).
 *
 * ENV:
 *   TRIPLEA_CLIENT_ID         — OAuth client ID (z Triple-A dashboardu)
 *   TRIPLEA_CLIENT_SECRET     — OAuth client secret
 *   TRIPLEA_API_ID            — Live API ID (merchant wallet pro 1 kryptoměnu)
 *   TRIPLEA_SANDBOX_API_ID    — Sandbox API ID (testBTC) — pro TRIPLEA_SANDBOX=true
 *   TRIPLEA_SANDBOX=true       — testovací režim (testnet)
 *   TRIPLEA_NOTIFY_SECRET     — sdílený tajný klíč pro HMAC ověření webhooku
 *   TRIPLEA_API_BASE_URL      — override base URL (default https://api.triple-a.io/api/v2)
 *
 * Reference (ověřeno z developers.triple-a.io 2026-06-30):
 *   Token:   POST {base}/oauth/token  (grant_type=client_credentials)
 *   Payment: POST {base}/payment      (type='triplea', sandbox?, webhook_data.order_id)
 *   Webhook: Triplea-Signature: t=<unix>,v1=<hmac-sha256(`${t}.${rawBody}`, notify_secret)>
 */
import { createHmac, timingSafeEqual } from 'crypto';

export interface TripleAConfig {
  clientId: string;
  clientSecret: string;
  apiId: string;
  sandbox: boolean;
  notifySecret: string;
  apiBaseUrl: string;
  isConfigured: boolean;
}

let warningLogged = false;
let cachedConfig: TripleAConfig | null = null;

export function getTripleAConfig(): TripleAConfig {
  if (cachedConfig) return cachedConfig;

  const clientId = process.env.TRIPLEA_CLIENT_ID ?? '';
  const clientSecret = process.env.TRIPLEA_CLIENT_SECRET ?? '';
  const sandbox = process.env.TRIPLEA_SANDBOX === 'true';
  const apiId = (sandbox ? process.env.TRIPLEA_SANDBOX_API_ID : process.env.TRIPLEA_API_ID) ?? '';
  const notifySecret = process.env.TRIPLEA_NOTIFY_SECRET ?? '';
  const apiBaseUrl = process.env.TRIPLEA_API_BASE_URL ?? 'https://api.triple-a.io/api/v2';

  // notifySecret je povinný — bez něj nelze ověřit webhook (fail-closed při platbě).
  const isConfigured = !!clientId && !!clientSecret && !!apiId && !!notifySecret;

  if (!isConfigured && !warningLogged) {
    // eslint-disable-next-line no-console
    console.warn(
      '[payment] Triple-A není nakonfigurovaný — krypto platba poběží v mock režimu. ' +
        'Nastavte TRIPLEA_CLIENT_ID, TRIPLEA_CLIENT_SECRET, TRIPLEA_API_ID, TRIPLEA_NOTIFY_SECRET.',
    );
    warningLogged = true;
  }

  cachedConfig = { clientId, clientSecret, apiId, sandbox, notifySecret, apiBaseUrl, isConfigured };
  return cachedConfig;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}
let cachedToken: CachedToken | null = null;

async function getAccessToken(config: TripleAConfig): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - now > 60_000) {
    return cachedToken.token;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
  }).toString();

  const res = await fetch(`${config.apiBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  if (!res.ok) throw new Error(`Triple-A OAuth selhalo: HTTP ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('Triple-A nevrátilo access_token');

  cachedToken = {
    token: json.access_token,
    // token validity 1h; necháme rezervu, refresh ~60s před expirací (viz check výše)
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}

export interface TripleACreateInput {
  orderId: string;
  amountHalire: number; // interní minor units (halíře)
  currency: string; // ISO 4217, prezentační měna merchanta
  notifyUrl: string;
  successUrl: string;
  cancelUrl: string;
}

export interface TripleACreateResult {
  paymentReference: string;
  hostedUrl: string;
}

/**
 * Vytvoří Triple-A platbu (external hosted form). Vrácený hostedUrl je redirect
 * target pro kupujícího; payment_reference ukládáme do orders.gopay_payment_id
 * (sjednocený sloupec), webhook podle něj order najde.
 */
export async function createTripleAPayment(
  input: TripleACreateInput,
): Promise<TripleACreateResult> {
  const config = getTripleAConfig();
  if (!config.isConfigured) {
    throw new Error('Triple-A not configured (refusing to create real crypto payment)');
  }

  const token = await getAccessToken(config);
  const payload: Record<string, unknown> = {
    type: 'triplea',
    api_id: config.apiId,
    order_currency: input.currency,
    // Triple-A order_amount je v HLAVNÍCH jednotkách (10 = 10 USD), interně máme halíře
    order_amount: Number((input.amountHalire / 100).toFixed(2)),
    notify_url: input.notifyUrl,
    notify_secret: config.notifySecret,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    webhook_data: { order_id: input.orderId },
  };
  if (config.sandbox) payload.sandbox = true;

  const res = await fetch(`${config.apiBaseUrl}/payment`, {
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
    throw new Error(`Triple-A createPayment HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as { payment_reference?: string; hosted_url?: string };
  if (!json.payment_reference || !json.hosted_url) {
    throw new Error('Triple-A nevrátilo payment_reference/hosted_url');
  }
  return { paymentReference: json.payment_reference, hostedUrl: json.hosted_url };
}

export interface TripleAWebhookVerification {
  valid: boolean;
  reason?: string;
}

/**
 * Ověří podpis webhooku. Header: `Triplea-Signature: t=<unix>,v1=<hex hmac>`.
 * HMAC-SHA256 přes `${t}.${rawBody}` s notify_secret; tolerance časové známky 300s.
 * rawBody MUSÍ být syrové tělo requestu (před JSON.parse), jinak podpis nesedí.
 */
export function verifyTripleAWebhook(
  rawBody: string,
  signatureHeader: string | null,
  nowMs: number,
): TripleAWebhookVerification {
  const config = getTripleAConfig();
  if (!config.notifySecret) return { valid: false, reason: 'NO_SECRET' };
  if (!signatureHeader) return { valid: false, reason: 'NO_SIGNATURE' };

  let t = '';
  let v1 = '';
  for (const part of signatureHeader.split(',')) {
    const [k, val] = part.split('=');
    if (k?.trim() === 't') t = (val ?? '').trim();
    else if (k?.trim() === 'v1') v1 = (val ?? '').trim();
  }
  if (!t || !v1) return { valid: false, reason: 'MALFORMED_SIGNATURE' };

  const expected = createHmac('sha256', config.notifySecret)
    .update(`${t}.${rawBody}`)
    .digest('hex');

  // timing-safe porovnání
  const a = Buffer.from(v1, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: 'SIGNATURE_MISMATCH' };
  }

  const tsSec = Number.parseInt(t, 10);
  if (!Number.isFinite(tsSec)) return { valid: false, reason: 'BAD_TIMESTAMP' };
  const nowSec = Math.round(nowMs / 1000);
  if (Math.abs(nowSec - tsSec) > 300) return { valid: false, reason: 'TIMESTAMP_OUT_OF_TOLERANCE' };

  return { valid: true };
}

/** Pro testy — vyčistit cache. */
export function _resetTripleACacheForTests(): void {
  cachedConfig = null;
  cachedToken = null;
  warningLogged = false;
}
