import type { DbAdapter, KafkaProducerAdapter } from '../types/referral.types';

// ============================================================
// Dual-side Referral Reward Service (Feature #63)
// ============================================================
//
// On a successful referral conversion, BOTH parties are rewarded:
//   - referrer:     `referrerRewardHalire`   (pending until order paid)
//   - new customer: `newCustomerRewardHalire` (immediate discount credit)
//
// All monetary values are expressed in haléře (1 CZK = 100 haléřů).

const KAFKA_TOPIC_REWARD_APPLIED = 'referral.reward_applied';

export interface DualRewardConfig {
  referrerRewardHalire: number;   // default 10000 = 100 Kč
  newCustomerRewardHalire: number; // default 10000 = 100 Kč
}

export const DEFAULT_DUAL_REWARD_CONFIG: DualRewardConfig = {
  referrerRewardHalire: 10000,
  newCustomerRewardHalire: 10000,
};

export interface DualRewardResult {
  referrerCreditId: string;
  newCustomerCreditId: string;
  referrerRewardHalire: number;
  newCustomerRewardHalire: number;
}

export interface ApplyReferralRewardDeps {
  db: DbAdapter;
  kafka: KafkaProducerAdapter;
  config?: DualRewardConfig;
  /** Anti-fraud: device fingerprint hashes seen in last 90 days (optional hook) */
  deviceFingerprint?: string | null;
  clientIp?: string | null;
}

export class SelfReferralRejectedError extends Error {
  constructor() {
    super('Self-referral is not permitted');
    this.name = 'SelfReferralRejectedError';
  }
}

export class DuplicateDeviceRejectedError extends Error {
  constructor(public readonly fingerprint: string) {
    super(`Device fingerprint ${fingerprint} already used for a referral in the last 90 days`);
    this.name = 'DuplicateDeviceRejectedError';
  }
}

/**
 * Apply the dual-side reward for a successful referral conversion.
 *
 * Idempotent per orderId: re-calls return the existing credit rows.
 */
export async function applyReferralReward(
  referrerId: string,
  newCustomerId: string,
  orderId: string,
  deps: ApplyReferralRewardDeps,
): Promise<DualRewardResult> {
  // ---- Anti-fraud #1: self-referral ---------------------------------------
  if (referrerId === newCustomerId) {
    throw new SelfReferralRejectedError();
  }

  const cfg = deps.config ?? DEFAULT_DUAL_REWARD_CONFIG;
  const { db, kafka } = deps;

  // ---- Anti-fraud #2: duplicate device fingerprint (90 day window) --------
  if (deps.deviceFingerprint) {
    const dup = await db.queryOne<{ id: string }>(
      `SELECT id FROM referral.dual_rewards
       WHERE device_fingerprint = $1
         AND created_at >= NOW() - INTERVAL '90 days'
       LIMIT 1`,
      [deps.deviceFingerprint],
    );
    if (dup) {
      throw new DuplicateDeviceRejectedError(deps.deviceFingerprint);
    }
  }

  // ---- Idempotency --------------------------------------------------------
  const existing = await db.queryOne<{
    referrer_credit_id: string;
    new_customer_credit_id: string;
  }>(
    `SELECT referrer_credit_id, new_customer_credit_id
     FROM referral.dual_rewards
     WHERE order_id = $1`,
    [orderId],
  );
  if (existing) {
    return {
      referrerCreditId: existing.referrer_credit_id,
      newCustomerCreditId: existing.new_customer_credit_id,
      referrerRewardHalire: cfg.referrerRewardHalire,
      newCustomerRewardHalire: cfg.newCustomerRewardHalire,
    };
  }

  // ---- Referrer credit (pending until order paid) ------------------------
  const referrerRow = await db.queryOne<{ id: string }>(
    `INSERT INTO referral.credit_transactions
       (user_id, amount_halire, type, reference_id, status, description)
     VALUES ($1, $2, 'referral_reward_referrer', $3, 'pending',
             'Referral reward (pending until order paid)')
     RETURNING id`,
    [referrerId, cfg.referrerRewardHalire, orderId],
  );

  // ---- New customer credit (immediate, usable as discount) ---------------
  const newCustomerRow = await db.queryOne<{ id: string }>(
    `INSERT INTO referral.credit_transactions
       (user_id, amount_halire, type, reference_id, status, description)
     VALUES ($1, $2, 'referral_reward_new_customer', $3, 'available',
             'Welcome referral discount')
     RETURNING id`,
    [newCustomerId, cfg.newCustomerRewardHalire, orderId],
  );

  if (!referrerRow || !newCustomerRow) {
    throw new Error('Failed to insert dual reward credit rows');
  }

  // ---- Audit / anti-fraud trail -------------------------------------------
  await db.execute(
    `INSERT INTO referral.dual_rewards
       (referrer_id, new_customer_id, order_id,
        referrer_credit_id, new_customer_credit_id,
        referrer_reward_halire, new_customer_reward_halire,
        device_fingerprint, client_ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      referrerId,
      newCustomerId,
      orderId,
      referrerRow.id,
      newCustomerRow.id,
      cfg.referrerRewardHalire,
      cfg.newCustomerRewardHalire,
      deps.deviceFingerprint ?? null,
      deps.clientIp ?? null,
    ],
  );

  // ---- Emit Kafka event ---------------------------------------------------
  await kafka.publish(KAFKA_TOPIC_REWARD_APPLIED, orderId, {
    orderId,
    referrerId,
    newCustomerId,
    referrerRewardHalire: cfg.referrerRewardHalire,
    newCustomerRewardHalire: cfg.newCustomerRewardHalire,
    referrerCreditId: referrerRow.id,
    newCustomerCreditId: newCustomerRow.id,
    occurredAt: new Date().toISOString(),
  });

  return {
    referrerCreditId: referrerRow.id,
    newCustomerCreditId: newCustomerRow.id,
    referrerRewardHalire: cfg.referrerRewardHalire,
    newCustomerRewardHalire: cfg.newCustomerRewardHalire,
  };
}
