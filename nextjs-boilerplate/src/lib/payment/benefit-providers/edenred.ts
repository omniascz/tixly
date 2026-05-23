/**
 * Edenred CZ Ticket Restaurant + Ticket Sport & Culture integration.
 *
 * Auth: API key v Authorization header. Edenred má open API spec na portálu.
 *
 * Env:
 *   - EDENRED_MERCHANT_ID — merchant code přidělený Edenred CZ
 *   - EDENRED_API_KEY     — API token
 *   - EDENRED_API_BASE_URL (optional) — default 'https://commerce-api.edenred.com/cz'
 *   - EDENRED_CALLBACK_SECRET — HMAC secret pro callback verify
 *
 * **Vendor docs nemáme** — payload shape je best-effort, real validace
 * v sandboxu nutná.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  BenefitProviderHandler,
  CreateBenefitPaymentInput,
} from '../benefits';

const DEFAULT_BASE_URL = 'https://commerce-api.edenred.com/cz';

interface EdenredInitResponse {
  externalId: string;
  redirectUrl: string;
  status: 'created' | 'redirected';
}

export const createEdenredPayment: BenefitProviderHandler = async (
  input: CreateBenefitPaymentInput,
  externalId: string,
): Promise<{ redirectUrl: string }> => {
  const merchantId = process.env.EDENRED_MERCHANT_ID;
  const apiKey = process.env.EDENRED_API_KEY;
  if (!merchantId || !apiKey) {
    throw new Error('EDENRED_MERCHANT_ID + EDENRED_API_KEY required');
  }
  const baseUrl = process.env.EDENRED_API_BASE_URL ?? DEFAULT_BASE_URL;

  const callbackUrl = `${input.appUrl}/api/payments/benefit/callback?provider=edenred&external_id=${externalId}`;
  const returnUrl = `${input.appUrl}/api/payments/benefit/return?provider=edenred&external_id=${externalId}`;

  const res = await fetch(`${baseUrl}/v2/payment/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `ApiKey ${apiKey}`,
      'X-Merchant-Id': merchantId,
      'Content-Type': 'application/json',
      'Idempotency-Key': externalId,
    },
    body: JSON.stringify({
      merchantTransactionId: externalId,
      amountMinor: input.amountHalire,
      currency: 'CZK',
      product: 'TICKET_SPORT_CULTURE', // 'TICKET_RESTAURANT' pro F&B
      customerEmail: input.buyerEmail,
      callbackUrl,
      returnUrl,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<empty>');
    throw new Error(
      `Edenred init failed: ${res.status} ${body.slice(0, 300)}`,
    );
  }

  const body = (await res.json()) as EdenredInitResponse;
  if (!body.redirectUrl) {
    throw new Error('Edenred response missing redirectUrl');
  }
  return { redirectUrl: body.redirectUrl };
};

export function verifyEdenredCallback(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.EDENRED_CALLBACK_SECRET;
  if (!secret || !signatureHeader) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = signatureHeader.replace(/^sha256=/, '');
  if (expected.length !== given.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(given, 'hex'),
    );
  } catch {
    return false;
  }
}
