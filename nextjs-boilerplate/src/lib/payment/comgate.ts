/**
 * ComGate REST API client — produkční implementace pro CZ + SK.
 *
 * ComGate REST API v2.0 — oficiální dokumentace https://apidoc.comgate.cz/en/api/rest/
 * Endpoint: https://payments.comgate.cz/v2.0
 * Auth: basic auth s merchant + secret
 *
 * Kolo 7: klient volal neexistující cesty (/payment, /payment/transaction/{id}, …/refund),
 * posílal `currency` místo `curr` a ze stavu četl `state` místo `status`. Teď podle dokumentace:
 *   POST /payment.json                  {test,country,price,curr,label(1–16),refId,method,email,fullName,lang,url_*}
 *   GET  /payment/transId/{transId}.json → {code,message,status,price(string),curr,…}
 *   POST /refund.json                   {transId,amount,test,refId} → {code:0,message:'OK'}
 * Ověřeno simulátorem podle dokumentace (tests/helpers/fake-comgate.mjs), proti sandboxu: tests/sandbox/.
 *
 * ENV:
 *   COMGATE_MERCHANT  — merchant ID (alfanumerický)
 *   COMGATE_SECRET    — API secret
 *   COMGATE_TEST=true — test mode
 *   COMGATE_REFUND_TIMEOUT_MS — timeout refundu (výchozí 20000)
 *
 * Reference: https://help.comgate.cz/v2/docs/payment-create
 */
import { assertStagingIsolated } from '@/lib/env/staging-guard';

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
  assertStagingIsolated(); // kolo 9: staging nikdy nepoužije ostrou bránu

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

  // ComGate API očekává price v haléřích/centech (= naše interní jednotka). label max 16 znaků.
  const payload = {
    test: config.test,
    country: input.currency === 'EUR' ? 'SK' : 'CZ',
    price: input.amountHalire,
    curr: input.currency,
    label: comGateLabel(input.description),
    refId: input.orderId,
    method: 'ALL', // všechny dostupné metody (karta, GPay, ApplePay, BankTransfer)
    email: input.buyerEmail,
    ...(input.buyerName ? { fullName: input.buyerName.slice(0, 255) } : {}),
    lang: input.currency === 'EUR' ? 'sk' : 'cs',
    // Návrat kupce z brány. Notifikace (push) jde na adresu nastavenou v klientském portálu ComGate.
    url_paid: input.returnUrl,
    url_cancelled: input.returnUrl,
    url_pending: input.returnUrl,
  };

  const res = await fetch(`${config.apiBaseUrl}/payment.json`, {
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

  const json = (await res.json()) as { code?: number; message?: string; transId: string; redirect: string };
  if (json.code !== undefined && json.code !== 0) {
    throw new Error(`ComGate createPayment code ${json.code}: ${json.message ?? ''}`);
  }
  return {
    paymentId: json.transId,
    gatewayUrl: json.redirect,
  };
}

/** label: 1–16 znaků (dokumentace ComGate). */
export function comGateLabel(description: string): string {
  const t = description.replace(/\s+/g, ' ').trim();
  return (t.length > 0 ? t : 'Vstupenky').slice(0, 16);
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
    `${config.apiBaseUrl}/payment/transId/${encodeURIComponent(paymentId)}.json`,
    {
      method: 'GET',
      headers: { Authorization: authHeader(config), Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) throw new Error(`ComGate getPayment HTTP ${res.status}`);

  const json = (await res.json()) as {
    code?: number;
    message?: string;
    status: string;
    price: string | number;
    curr: string;
  };
  if (json.code !== undefined && json.code !== 0) {
    throw new Error(`ComGate getPayment code ${json.code}: ${json.message ?? ''}`);
  }
  // ComGate stavy (apidoc.comgate.cz/en/stavy-plateb): PENDING | AUTHORIZED | PAID | CANCELLED.
  // Stav REFUNDED API nemá — vrácení sledujeme vlastním refund tokem.
  return {
    state: json.status,
    paid: json.status === 'PAID',
    refunded: false,
    amountHalire: Number(json.price),
    currency: json.curr,
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

  // Timeout (jako GoPay, K2): bez něj by refund při výpadku brány visel navždy.
  const timeoutMs = Number(process.env.COMGATE_REFUND_TIMEOUT_MS ?? 20000);
  let res: Response;
  try {
    res = await fetch(`${config.apiBaseUrl}/refund.json`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(config),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ transId: paymentId, amount: amountHalire, test: config.test }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, raw: { error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) } };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, raw: { status: res.status, body: text } };
  }
  const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
  // Úspěch jen s code 0 (dokumentace: {code:0,message:'OK'}).
  return { ok: json.code === 0, raw: json };
}

/** Pro testy. */
export function _resetComGateCacheForTests(): void {
  cachedConfig = null;
  warningLogged = false;
}
