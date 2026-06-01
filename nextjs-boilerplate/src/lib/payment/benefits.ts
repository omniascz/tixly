/**
 * Benefit payment providers (CZ): Pluxee/Sodexo, Benefit Plus, Gallery Beta, Edenred.
 *
 * Real integrace per provider vyžaduje:
 *   - vendor API klíče (proprietary, žádný společný standard)
 *   - schválené merchant account
 *   - whitelisted callback URL
 *
 * Tento helper poskytuje switcher + mock fallback pokud vendor klíče chybí.
 *
 * Pluxee:        env PLUXEE_MERCHANT_ID, PLUXEE_API_KEY
 * Benefit Plus:  env BENEFIT_PLUS_PARTNER_ID, BENEFIT_PLUS_SECRET
 * Gallery Beta:  env GALLERY_BETA_API_KEY
 * Edenred:       env EDENRED_MERCHANT_ID, EDENRED_API_KEY
 */

import { randomUUID } from 'crypto';
import { db } from '@/lib/db/rls-pool';


export type BenefitProvider = 'pluxee' | 'benefit_plus' | 'gallery_beta' | 'edenred';

export interface CreateBenefitPaymentInput {
  orderId: string;
  amountHalire: number;
  buyerEmail: string;
  provider: BenefitProvider;
  appUrl: string;
}

export interface BenefitPaymentResult {
  redirectUrl: string;
  externalId: string;
  isMock: boolean;
}

function hasRealCredentials(provider: BenefitProvider): boolean {
  switch (provider) {
    case 'pluxee':
      return Boolean(process.env.PLUXEE_MERCHANT_ID && process.env.PLUXEE_API_KEY);
    case 'benefit_plus':
      return Boolean(process.env.BENEFIT_PLUS_PARTNER_ID && process.env.BENEFIT_PLUS_SECRET);
    case 'gallery_beta':
      return Boolean(process.env.GALLERY_BETA_API_KEY);
    case 'edenred':
      return Boolean(process.env.EDENRED_MERCHANT_ID && process.env.EDENRED_API_KEY);
    default:
      return false;
  }
}

/**
 * Vytvoří benefit payment session pro daný order.
 *
 * Resolution priorita:
 *   1. Real vendor URL — pokud `hasRealCredentials(provider)===true` a
 *      per-provider create funkce existuje.
 *   2. Mock fallback — jen pokud `BENEFIT_DEV_MOCK_FALLBACK=1` (explicit
 *      opt-in pro dev/CI) NEBO `NODE_ENV !== 'production'`.
 *   3. Jinak vyhodí `BenefitProviderUnavailableError` — produkce s chybějícími
 *      env vendor klíči se nebude tichá fallbackovat (předtím byl bug:
 *      vždy redirect na mock i s credentials).
 *
 * Per-provider real implementace zatím chybí (vendor partnership nutná);
 * až je doplníš v src/lib/payment/benefit-providers/<provider>.ts, importuj
 * sem do PROVIDER_HANDLERS mapy.
 */
export class BenefitProviderUnavailableError extends Error {
  readonly code = 'BENEFIT_PROVIDER_UNAVAILABLE' as const;
  constructor(
    readonly provider: BenefitProvider,
    readonly reason: 'no_credentials' | 'no_handler' | 'vendor_call_failed',
  ) {
    super(
      `Benefit provider ${provider} unavailable: ${reason}. ` +
        `Set vendor env keys + implement createXxxPayment in benefit-providers/.`,
    );
    this.name = 'BenefitProviderUnavailableError';
  }
}

export type BenefitProviderHandler = (
  input: CreateBenefitPaymentInput,
  externalId: string,
) => Promise<{ redirectUrl: string }>;

// Per-provider real handlery. Implementace v src/lib/payment/benefit-providers/.
// Pokud handler vyhodí, createBenefitPayment ho zachytí a převede na
// BenefitProviderUnavailableError s reason='vendor_call_failed'.
//
// Žádný silent mock fallback uvnitř handleru! Mock se aktivuje jen na úrovni
// createBenefitPayment switche když hasRealCredentials === false A shouldUseMock().
import {
  createBenefitPlusPayment,
  createEdenredPayment,
  createGalleryBetaPayment,
  createPluxeePayment,
} from './benefit-providers';

const PROVIDER_HANDLERS: Partial<Record<BenefitProvider, BenefitProviderHandler>> = {
  pluxee: createPluxeePayment,
  benefit_plus: createBenefitPlusPayment,
  edenred: createEdenredPayment,
  gallery_beta: createGalleryBetaPayment,
};

function shouldUseMock(): boolean {
  if (process.env.BENEFIT_DEV_MOCK_FALLBACK === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

export async function createBenefitPayment(
  input: CreateBenefitPaymentInput,
): Promise<BenefitPaymentResult> {
  const externalId = randomUUID();
  const hasCreds = hasRealCredentials(input.provider);
  const handler = PROVIDER_HANDLERS[input.provider];

  let redirectUrl: string;
  let isMock = false;

  if (hasCreds && handler) {
    // Skutečný vendor call — pokud handler hodí (vendor 4xx/5xx, network,
    // parse fail), překonvertujeme na typed error aby caller mohl správně
    // 503 odpovědět buyer-side a my logovali na incident.
    try {
      const result = await handler(input, externalId);
      redirectUrl = result.redirectUrl;
    } catch (err) {
      console.error(`[benefit ${input.provider}] vendor call failed`, err);
      throw new BenefitProviderUnavailableError(
        input.provider,
        'vendor_call_failed',
      );
    }
  } else if (shouldUseMock()) {
    // Dev/test mock fallback — explicit opt-in via NODE_ENV nebo env flag
    redirectUrl = `${input.appUrl}/mock-benefit/${input.provider}/${externalId}`;
    isMock = true;
  } else {
    // Produkce + chybějící credentials/handler — fail loud
    throw new BenefitProviderUnavailableError(
      input.provider,
      !hasCreds ? 'no_credentials' : 'no_handler',
    );
  }

  await db().query(
    `INSERT INTO orders.benefit_payments
       (order_id, provider, external_id, amount_halire, status, redirect_url)
     VALUES ($1, $2, $3, $4, 'redirected', $5)`,
    [input.orderId, input.provider, externalId, input.amountHalire, redirectUrl],
  );

  return { redirectUrl, externalId, isMock };
}

/**
 * Zpracuje callback od provideru — markne payment + order jako paid.
 * Idempotent: opakovaný callback se ignoruje.
 */
export async function handleBenefitCallback(input: {
  provider: BenefitProvider;
  externalId: string;
  success: boolean;
  payload: Record<string, unknown>;
}): Promise<{ orderId: string | null; status: 'paid' | 'failed' | 'duplicate' | 'not_found' }> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const bp = await client.query<{
      id: string;
      order_id: string;
      status: string;
      amount_halire: number;
    }>(
      `SELECT id, order_id, status, amount_halire
       FROM orders.benefit_payments
       WHERE provider = $1 AND external_id = $2
       FOR UPDATE`,
      [input.provider, input.externalId],
    );
    if (bp.rows.length === 0) {
      await client.query('ROLLBACK');
      return { orderId: null, status: 'not_found' };
    }
    const payment = bp.rows[0];

    if (payment.status === 'paid') {
      await client.query('ROLLBACK');
      return { orderId: payment.order_id, status: 'duplicate' };
    }

    const newStatus = input.success ? 'paid' : 'failed';

    await client.query(
      `UPDATE orders.benefit_payments
       SET status = $2, callback_payload = $3::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [payment.id, newStatus, JSON.stringify(input.payload)],
    );

    if (input.success) {
      await client.query(
        `UPDATE orders.orders
         SET status = 'paid', paid_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'pending'`,
        [payment.order_id],
      );
    }

    await client.query('COMMIT');
    return { orderId: payment.order_id, status: newStatus };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
