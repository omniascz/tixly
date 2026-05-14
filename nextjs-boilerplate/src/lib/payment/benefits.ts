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
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

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
 * Vytvoří benefit payment session pro daný order. Pokud chybí vendor credentials,
 * vrátí mock redirect na lokální /mock-benefit/[provider]/[id].
 */
export async function createBenefitPayment(
  input: CreateBenefitPaymentInput,
): Promise<BenefitPaymentResult> {
  const externalId = randomUUID();
  const isMock = !hasRealCredentials(input.provider);

  let redirectUrl: string;
  if (isMock) {
    redirectUrl = `${input.appUrl}/mock-benefit/${input.provider}/${externalId}`;
  } else {
    // TODO: real provider redirect URL po vendor docs
    // Pluxee:        POST /api/transactional/create → response.redirect_url
    // Benefit Plus:  POST /payment/init → response.payUrl
    // Gallery Beta:  GET vendor portal s queryparams
    // Pro MVP: fallback na mock (zatím)
    redirectUrl = `${input.appUrl}/mock-benefit/${input.provider}/${externalId}`;
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
    const payment = bp.rows[0]!;

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
