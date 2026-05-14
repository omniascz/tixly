/**
 * Loyalty engine — earning + redemption.
 *
 * Earning rules:
 *   1 bod / 10 Kč gross po DPH.
 *   Tier multiplier: bronze 1×, silver 1.1×, gold 1.25×.
 *
 * Redemption:
 *   1 bod = 1 Kč sleva. Max 50 % z order subtotal.
 *
 * Expiration: 24 měsíců od získání (FIFO oldest-first).
 */

import type { PoolClient } from 'pg';

const EARN_RATE_HALIRE_PER_POINT = 1000; // 10 Kč = 1 bod
const REDEMPTION_HALIRE_PER_POINT = 100; // 1 bod = 1 Kč sleva
const MAX_REDEMPTION_PCT = 50;
const EXPIRATION_MONTHS = 24;

export type LoyaltyTier = 'bronze' | 'silver' | 'gold';

const TIER_MULTIPLIERS: Record<LoyaltyTier, number> = {
  bronze: 1,
  silver: 1.1,
  gold: 1.25,
};

const TIER_THRESHOLDS: Record<LoyaltyTier, number> = {
  bronze: 0,
  silver: 500,
  gold: 2000,
};

function tierForLifetime(lifetime: number): LoyaltyTier {
  if (lifetime >= TIER_THRESHOLDS.gold) return 'gold';
  if (lifetime >= TIER_THRESHOLDS.silver) return 'silver';
  return 'bronze';
}

/**
 * Award points po dokončení objednávky. Idempotent na order_id — pokud existuje
 * earn_purchase transakce pro tento order, nic se nestane.
 */
export async function awardPointsForOrder(
  client: PoolClient,
  input: {
    userId: string;
    orderId: string;
    orderTotalHalire: number;
  },
): Promise<{ awarded: number; tier: LoyaltyTier; newBalance: number }> {
  // Idempotency check
  const existing = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM marketing.loyalty_transactions
     WHERE order_id = $1 AND kind = 'earn_purchase'`,
    [input.orderId],
  );
  if (Number(existing.rows[0]?.count ?? 0) > 0) {
    const acc = await client.query<{ points_balance: number; tier: string }>(
      `SELECT points_balance, tier FROM marketing.loyalty_accounts WHERE user_id = $1`,
      [input.userId],
    );
    return {
      awarded: 0,
      tier: (acc.rows[0]?.tier ?? 'bronze') as LoyaltyTier,
      newBalance: acc.rows[0]?.points_balance ?? 0,
    };
  }

  // Get or create account
  const accRes = await client.query<{
    id: string;
    points_balance: number;
    lifetime_points: number;
    tier: string;
  }>(
    `INSERT INTO marketing.loyalty_accounts (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
     RETURNING id, points_balance, lifetime_points, tier`,
    [input.userId],
  );
  const acc = accRes.rows[0]!;

  const currentTier = acc.tier as LoyaltyTier;
  const multiplier = TIER_MULTIPLIERS[currentTier];
  const basePoints = Math.floor(input.orderTotalHalire / EARN_RATE_HALIRE_PER_POINT);
  const awarded = Math.floor(basePoints * multiplier);

  if (awarded === 0) {
    return { awarded: 0, tier: currentTier, newBalance: acc.points_balance };
  }

  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + EXPIRATION_MONTHS);

  await client.query(
    `INSERT INTO marketing.loyalty_transactions
       (account_id, points_delta, kind, reason, order_id, expires_at)
     VALUES ($1, $2, 'earn_purchase', $3, $4, $5)`,
    [
      acc.id,
      awarded,
      `Nákup ${(input.orderTotalHalire / 100).toFixed(0)} Kč × ${multiplier} (${currentTier})`,
      input.orderId,
      expiresAt.toISOString(),
    ],
  );

  const newLifetime = acc.lifetime_points + awarded;
  const newTier = tierForLifetime(newLifetime);
  const newBalance = acc.points_balance + awarded;

  await client.query(
    `UPDATE marketing.loyalty_accounts
     SET points_balance = $2, lifetime_points = $3, tier = $4, updated_at = NOW()
     WHERE id = $1`,
    [acc.id, newBalance, newLifetime, newTier],
  );

  return { awarded, tier: newTier, newBalance };
}

/**
 * Spočítá maximální body, které lze uplatnit pro daný order subtotal.
 * Limit: min(account_balance, subtotal * 50% / 100 halíře_per_point).
 */
export function calculateMaxRedemption(input: {
  pointsBalance: number;
  orderSubtotalHalire: number;
}): { maxPoints: number; maxDiscountHalire: number } {
  const maxFromBudget = Math.floor(
    (input.orderSubtotalHalire * MAX_REDEMPTION_PCT) / 100 / REDEMPTION_HALIRE_PER_POINT,
  );
  const maxPoints = Math.min(input.pointsBalance, maxFromBudget);
  return {
    maxPoints,
    maxDiscountHalire: maxPoints * REDEMPTION_HALIRE_PER_POINT,
  };
}

/**
 * Aplikuj redemption — odečte body, zaloguje transakci. Volá se v checkoutu
 * uvnitř existující transakce.
 */
export async function redeemPoints(
  client: PoolClient,
  input: {
    userId: string;
    orderId: string;
    pointsToRedeem: number;
    orderSubtotalHalire: number;
  },
): Promise<{ discountHalire: number; redeemed: number; remaining: number }> {
  if (input.pointsToRedeem <= 0) {
    return { discountHalire: 0, redeemed: 0, remaining: 0 };
  }

  const accRes = await client.query<{ id: string; points_balance: number }>(
    `SELECT id, points_balance FROM marketing.loyalty_accounts
     WHERE user_id = $1 FOR UPDATE`,
    [input.userId],
  );
  if (accRes.rows.length === 0) {
    throw new Error('LOYALTY_ACCOUNT_NOT_FOUND');
  }
  const acc = accRes.rows[0]!;

  const limits = calculateMaxRedemption({
    pointsBalance: acc.points_balance,
    orderSubtotalHalire: input.orderSubtotalHalire,
  });
  const actualRedeem = Math.min(input.pointsToRedeem, limits.maxPoints);
  if (actualRedeem === 0) {
    return { discountHalire: 0, redeemed: 0, remaining: acc.points_balance };
  }
  const discount = actualRedeem * REDEMPTION_HALIRE_PER_POINT;

  await client.query(
    `INSERT INTO marketing.loyalty_transactions
       (account_id, points_delta, kind, reason, order_id)
     VALUES ($1, $2, 'redeem_checkout', $3, $4)`,
    [
      acc.id,
      -actualRedeem,
      `Uplatněno ${actualRedeem} bodů → −${(discount / 100).toFixed(0)} Kč sleva`,
      input.orderId,
    ],
  );

  const newBalance = acc.points_balance - actualRedeem;
  await client.query(
    `UPDATE marketing.loyalty_accounts
     SET points_balance = $2, updated_at = NOW()
     WHERE id = $1`,
    [acc.id, newBalance],
  );

  return { discountHalire: discount, redeemed: actualRedeem, remaining: newBalance };
}

export { TIER_MULTIPLIERS, TIER_THRESHOLDS, REDEMPTION_HALIRE_PER_POINT, MAX_REDEMPTION_PCT };
