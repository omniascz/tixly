/**
 * Benefit Plus (Benefit Management s.r.o.) integration.
 *
 * Auth: partner_id + secret. Signature je HMAC-SHA256 nad serializovanými
 * fields, posílaný jako field `signature` v body (proprietární scheme).
 *
 * Env:
 *   - BENEFIT_PLUS_PARTNER_ID — partner code přidělený Benefit Plus
 *   - BENEFIT_PLUS_SECRET     — shared secret pro HMAC signature
 *   - BENEFIT_PLUS_API_BASE_URL (optional) — default 'https://api.benefit-plus.cz'
 *
 * **Vendor docs zatím nemáme** — payload tvar je best-effort. Benefit Plus
 * historicky používal SOAP, novější REST je shape standardní (POST init →
 * payUrl + paymentId, callback s signed body).
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  BenefitProviderHandler,
  CreateBenefitPaymentInput,
} from '../benefits';

const DEFAULT_BASE_URL = 'https://api.benefit-plus.cz';

interface BenefitPlusInitResponse {
  paymentId: string;
  payUrl: string;
  expiresAt: string;
  signature: string;
}

function signFields(
  fields: Record<string, string | number>,
  secret: string,
): string {
  // Deterministic concat — Benefit Plus typical pattern: keys sorted alphabetically
  const keys = Object.keys(fields).sort();
  const payload = keys.map((k) => `${k}=${fields[k]}`).join('&');
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export const createBenefitPlusPayment: BenefitProviderHandler = async (
  input: CreateBenefitPaymentInput,
  externalId: string,
): Promise<{ redirectUrl: string }> => {
  const partnerId = process.env.BENEFIT_PLUS_PARTNER_ID;
  const secret = process.env.BENEFIT_PLUS_SECRET;
  if (!partnerId || !secret) {
    throw new Error('BENEFIT_PLUS_PARTNER_ID + BENEFIT_PLUS_SECRET required');
  }
  const baseUrl = process.env.BENEFIT_PLUS_API_BASE_URL ?? DEFAULT_BASE_URL;

  const fields = {
    partnerId,
    externalRef: externalId,
    amount: input.amountHalire,
    currency: 'CZK',
    email: input.buyerEmail,
  };
  const signature = signFields(fields, secret);

  const res = await fetch(`${baseUrl}/v1/payment/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...fields, signature }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<empty>');
    throw new Error(
      `Benefit Plus init failed: ${res.status} ${body.slice(0, 300)}`,
    );
  }

  const body = (await res.json()) as BenefitPlusInitResponse;
  if (!body.payUrl) {
    throw new Error('Benefit Plus response missing payUrl');
  }
  return { redirectUrl: body.payUrl };
};

/**
 * Verify callback signature. Benefit Plus posílá signature jako field v body
 * (ne header) — re-signováno z všech ostatních fields.
 */
export function verifyBenefitPlusCallback(
  body: Record<string, unknown>,
): boolean {
  const secret = process.env.BENEFIT_PLUS_SECRET;
  if (!secret) return false;
  const givenSig = String(body.signature ?? '');
  if (!givenSig) return false;
  const fieldsCopy = { ...body };
  delete fieldsCopy.signature;
  // Normalize to string fields for signing
  const normalized: Record<string, string | number> = {};
  for (const k of Object.keys(fieldsCopy)) {
    const v = fieldsCopy[k];
    if (typeof v === 'string' || typeof v === 'number') normalized[k] = v;
  }
  const expected = signFields(normalized, secret);
  if (expected.length !== givenSig.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(givenSig, 'hex'),
    );
  } catch {
    return false;
  }
}
