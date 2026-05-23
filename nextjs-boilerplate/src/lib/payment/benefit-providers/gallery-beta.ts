/**
 * Gallery Beta CZ benefit card integration.
 *
 * Gallery Beta je menší CZ benefit provider — méně technické dokumentace
 * než Pluxee/Edenred. Předpokládáme typický REST shape.
 *
 * Env:
 *   - GALLERY_BETA_API_KEY    — partner token
 *   - GALLERY_BETA_API_BASE_URL (optional) — default 'https://api.gallerybeta.cz'
 *   - GALLERY_BETA_CALLBACK_SECRET — HMAC verify
 *
 * **Vendor docs nemáme.** Stub vyžaduje real validation.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  BenefitProviderHandler,
  CreateBenefitPaymentInput,
} from '../benefits';

const DEFAULT_BASE_URL = 'https://api.gallerybeta.cz';

interface GalleryInitResponse {
  paymentId: string;
  redirectUrl: string;
}

export const createGalleryBetaPayment: BenefitProviderHandler = async (
  input: CreateBenefitPaymentInput,
  externalId: string,
): Promise<{ redirectUrl: string }> => {
  const apiKey = process.env.GALLERY_BETA_API_KEY;
  if (!apiKey) throw new Error('GALLERY_BETA_API_KEY required');
  const baseUrl = process.env.GALLERY_BETA_API_BASE_URL ?? DEFAULT_BASE_URL;

  const callbackUrl = `${input.appUrl}/api/payments/benefit/callback?provider=gallery_beta&external_id=${externalId}`;

  const res = await fetch(`${baseUrl}/api/v1/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': externalId,
    },
    body: JSON.stringify({
      externalReference: externalId,
      amount: input.amountHalire,
      currency: 'CZK',
      email: input.buyerEmail,
      webhookUrl: callbackUrl,
      successUrl: `${input.appUrl}/cs/order-confirmation/${externalId}`,
      cancelUrl: `${input.appUrl}/cs/checkout`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<empty>');
    throw new Error(
      `Gallery Beta init failed: ${res.status} ${body.slice(0, 300)}`,
    );
  }

  const body = (await res.json()) as GalleryInitResponse;
  if (!body.redirectUrl) {
    throw new Error('Gallery Beta response missing redirectUrl');
  }
  return { redirectUrl: body.redirectUrl };
};

export function verifyGalleryBetaCallback(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.GALLERY_BETA_CALLBACK_SECRET;
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
