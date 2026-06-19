/**
 * Multisport CZ benefit card payment integration.
 *
 * Provozovatel: BenefitSystems s.r.o. (dříve Multisport Benefit s.r.o.)
 * Multisport Kultura karta pokrývá divadelní a kulturní vstupenky — cílový
 * segment pro divadla (Kalich, Divadlo v Celetné apod.).
 *
 * Auth: OAuth2 client_credentials. Env:
 *   - MULTISPORT_MERCHANT_ID   — partner ID přidělený BenefitSystems
 *   - MULTISPORT_API_KEY       — API secret / bearer token
 *   - MULTISPORT_API_BASE_URL  — default 'https://api.benefitsystems.cz'
 *   - MULTISPORT_CALLBACK_SECRET — HMAC secret pro callback signature verify
 *
 * **Vendor docs zatím nemáme** — endpointy jsou best-effort podle typického
 * OAuth2 + REST patternu. Real validace nutná v sandbox testu s BenefitSystems
 * před produkčním nasazením.
 *
 * Reference:
 *   - BenefitSystems partner portal: https://partners.benefitsystems.cz/
 *   - Multisport Kultura program: https://multisport.cz/kultura/
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  BenefitProviderHandler,
  CreateBenefitPaymentInput,
} from '../benefits';

const DEFAULT_BASE_URL = 'https://api.benefitsystems.cz';

interface MultisportCreateResponse {
  transactionId: string;
  redirectUrl: string;
  status: 'pending' | 'redirected' | 'failed';
  expiresAt: string;
}

class MultisportApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = 'MultisportApiError';
  }
}

export const createMultisportPayment: BenefitProviderHandler = async (
  input: CreateBenefitPaymentInput,
  externalId: string,
): Promise<{ redirectUrl: string }> => {
  const merchantId = process.env.MULTISPORT_MERCHANT_ID;
  const apiKey = process.env.MULTISPORT_API_KEY;
  if (!merchantId || !apiKey) {
    throw new Error('MULTISPORT_MERCHANT_ID + MULTISPORT_API_KEY required');
  }
  const baseUrl = process.env.MULTISPORT_API_BASE_URL ?? DEFAULT_BASE_URL;

  const callbackUrl = `${input.appUrl}/api/payments/benefit/callback?provider=multisport&external_id=${externalId}`;

  const res = await fetch(`${baseUrl}/v1/payments/create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-Merchant-Id': merchantId,
      'Content-Type': 'application/json',
      'Idempotency-Key': externalId,
    },
    body: JSON.stringify({
      merchantTransactionId: externalId,
      amountMinor: input.amountHalire,
      currency: 'CZK',
      buyerEmail: input.buyerEmail,
      callbackUrl,
      returnUrl: `${input.appUrl}/api/payments/benefit/return?provider=multisport&external_id=${externalId}`,
      // Multisport Kultura — category identifier pro kulturní vstupenky
      category: 'CULTURE',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<empty>');
    throw new MultisportApiError(
      res.status,
      body.slice(0, 500),
      `Multisport create failed: ${res.status}`,
    );
  }

  const body = (await res.json()) as MultisportCreateResponse;
  if (!body.redirectUrl) {
    throw new Error('Multisport response missing redirectUrl');
  }
  return { redirectUrl: body.redirectUrl };
};

/**
 * Verify HMAC-SHA256 callback signature.
 * BenefitSystems posílá `X-Multisport-Signature` header = HEX HMAC nad raw body.
 */
export function verifyMultisportCallback(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.MULTISPORT_CALLBACK_SECRET;
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
