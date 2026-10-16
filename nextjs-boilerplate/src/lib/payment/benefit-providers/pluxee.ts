/**
 * Pluxee CZ benefit card payment integration.
 *
 * Pluxee koupil Sodexo Benefits CZ v 2023, takže oba paymentMethod ('pluxee'
 * + 'sodexo') routují na tento handler (sodexo→pluxee re-map se děje v
 * checkout/route.ts).
 *
 * Auth: OAuth2 client_credentials. Env:
 *   - PLUXEE_MERCHANT_ID — partner identifier (string)
 *   - PLUXEE_API_KEY     — client secret / API token
 *   - PLUXEE_API_BASE_URL (optional) — default 'https://api.pluxee.cz'
 *   - PLUXEE_CALLBACK_SECRET — HMAC secret pro callback signature verify
 *
 * **Vendor docs zatím nemáme** — endpointy + payload tvary jsou best-effort
 * podle typického OAuth2 + REST patternu (Mastercard Acceptance, ČSOB Klient).
 * Real validace nutná v sandbox testu před produkčním nasazením.
 *
 * Reference:
 *   - Pluxee partner portal: https://partners.pluxee.cz/
 *   - Mastercard Pluxee integration: 2023 acquisition consolidates Sodexo Benefits CZ
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  BenefitProviderHandler,
  CreateBenefitPaymentInput,
} from '../benefits';

const DEFAULT_BASE_URL = 'https://api.pluxee.cz';

interface PluxeeCreateResponse {
  transactionId: string;
  redirectUrl: string;
  status: 'pending' | 'redirected' | 'failed';
  expiresAt: string;
}

class PluxeeApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = 'PluxeeApiError';
  }
}

export const createPluxeePayment: BenefitProviderHandler = async (
  input: CreateBenefitPaymentInput,
  externalId: string,
): Promise<{ redirectUrl: string }> => {
  const merchantId = process.env.PLUXEE_MERCHANT_ID;
  const apiKey = process.env.PLUXEE_API_KEY;
  if (!merchantId || !apiKey) {
    throw new Error('PLUXEE_MERCHANT_ID + PLUXEE_API_KEY required');
  }
  const baseUrl = process.env.PLUXEE_API_BASE_URL ?? DEFAULT_BASE_URL;

  // Callback URL — vendor zavolá při payment success/failure
  // Kolo 2: na per-provider routu s ověřením HMAC podpisu — generická /benefit/callback
  // je v produkci zakázaná (nemá ověření), takže by legitimní callback nikdy neprošel.
  const callbackUrl = `${input.appUrl}/api/payments/benefit/pluxee/callback?external_id=${externalId}`;

  const res = await fetch(`${baseUrl}/v1/transactional/create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-Merchant-Id': merchantId,
      'Content-Type': 'application/json',
      // Idempotency key — vendor by měl deduplicate na opakovaný request
      'Idempotency-Key': externalId,
    },
    body: JSON.stringify({
      merchantTransactionId: externalId,
      amountMinor: input.amountHalire,
      currency: 'CZK',
      buyerEmail: input.buyerEmail,
      callbackUrl,
      // returnUrl — kam vendor přesměruje buyer po dokončení
      returnUrl: `${input.appUrl}/api/payments/benefit/return?provider=pluxee&external_id=${externalId}`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<empty>');
    throw new PluxeeApiError(
      res.status,
      body.slice(0, 500),
      `Pluxee create failed: ${res.status}`,
    );
  }

  const body = (await res.json()) as PluxeeCreateResponse;
  if (!body.redirectUrl) {
    throw new Error('Pluxee response missing redirectUrl');
  }
  return { redirectUrl: body.redirectUrl };
};

/**
 * Verify HMAC-SHA256 callback signature.
 * Pluxee posílá `X-Pluxee-Signature` header = HEX HMAC nad raw body.
 */
export function verifyPluxeeCallback(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.PLUXEE_CALLBACK_SECRET;
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
