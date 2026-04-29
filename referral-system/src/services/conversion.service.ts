import {
  getLastClickAttribution,
} from '../lib/attribution';
import { calculateCommission } from '../lib/attribution';
import { getClicksForVisitor, markClickConverted } from './click-tracking.service';
import { addCredit } from './credit.service';
import type {
  ReferralConversion,
  RecordConversionPayload,
  DbAdapter,
  KafkaProducerAdapter,
} from '../types/referral.types';
import {
  ConversionStatus,
  CreditTransactionType,
  SelfReferralError,
  LinkNotFoundError,
} from '../types/referral.types';
import { getLinkByCode } from './referral-link.service';

// ============================================================
// Conversion Service
//
// Všechny peněžní hodnoty jsou v INTEGER haléřích.
// ============================================================

/** Commission rate in basis points (5.00 %). */
const DEFAULT_COMMISSION_BPS = 500;
const KAFKA_TOPIC_REFERRAL_CONVERTED = 'referral.converted';

interface ConversionRow {
  id: string;
  link_id: string;
  click_id: string | null;
  order_id: string;
  referred_user_id: string;
  order_amount_halire: string | number;
  commission_rate: string;
  earned_halire: string | number;
  status: string;
  created_at: string;
  confirmed_at: string | null;
  paid_at: string | null;
}

function toInt(value: string | number): number {
  return typeof value === 'number' ? value : parseInt(value, 10);
}

function mapRow(row: ConversionRow): ReferralConversion {
  return {
    id: row.id,
    linkId: row.link_id,
    clickId: row.click_id ? BigInt(row.click_id) : null,
    orderId: row.order_id,
    referredUserId: row.referred_user_id,
    orderAmountHalire: toInt(row.order_amount_halire),
    commissionRate: parseFloat(row.commission_rate),
    earnedHalire: toInt(row.earned_halire),
    status: row.status as ConversionStatus,
    createdAt: new Date(row.created_at),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : null,
    paidAt: row.paid_at ? new Date(row.paid_at) : null,
  };
}

/**
 * Record a new referral conversion.
 *
 * Flow:
 * 1. Resolve the referral link from the code
 * 2. Guard against self-referral
 * 3. Find the attributing click (last-click model)
 * 4. Calculate commission
 * 5. Insert conversion record
 * 6. Credit the referrer's wallet (pending — confirmed later)
 * 7. Emit Kafka event
 * 8. Update link aggregate stats
 */
export async function recordConversion(
  payload: RecordConversionPayload,
  db: DbAdapter,
  kafka: KafkaProducerAdapter,
): Promise<ReferralConversion> {
  if (!Number.isInteger(payload.orderAmountHalire) || payload.orderAmountHalire < 0) {
    throw new Error(
      `orderAmountHalire must be a non-negative integer, got ${payload.orderAmountHalire}`,
    );
  }

  // 1. Resolve link
  const link = await getLinkByCode(payload.referrerCode, db);
  if (!link) {
    throw new LinkNotFoundError(payload.referrerCode);
  }

  // 2. Self-referral guard
  if (link.userId === payload.referredUserId) {
    throw new SelfReferralError();
  }

  // 3. Attribution
  const visitorClicks = await getClicksForVisitor(payload.visitorId, db);
  const attributingClick = getLastClickAttribution(
    visitorClicks,
    new Date(),
  );

  // 4. Calculate commission (bps → haléře, integer math)
  const earnedHalire = calculateCommission(
    payload.orderAmountHalire,
    DEFAULT_COMMISSION_BPS,
  );

  // commission_rate is stored as NUMERIC(5,4) — convert bps (int) to fraction
  const commissionRateDecimal = DEFAULT_COMMISSION_BPS / 10_000;

  // 5. Insert conversion (status: pending)
  const row = await db.queryOne<ConversionRow>(
    `INSERT INTO referral.conversions
       (link_id, click_id, order_id, referred_user_id,
        order_amount_halire, commission_rate, earned_halire)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      link.id,
      attributingClick ? attributingClick.id.toString() : null,
      payload.orderId,
      payload.referredUserId,
      payload.orderAmountHalire,
      commissionRateDecimal,
      earnedHalire,
    ],
  );

  if (!row) {
    throw new Error('INSERT into referral.conversions did not return a row');
  }

  const conversion = mapRow(row);

  // 6. Mark attributing click as converted
  if (attributingClick) {
    await markClickConverted(attributingClick.id, db);
  }

  // 7. Add credit to referrer wallet (pending — actual payout on confirmConversion).
  //    Nula by porušila addCredit guard; drobné objednávky neodměňujeme.
  if (earnedHalire > 0) {
    await addCredit(
      link.userId,
      earnedHalire,
      CreditTransactionType.ReferralEarned,
      conversion.id,
      `Referral reward for order ${payload.orderId} (pending confirmation)`,
      db,
    );
  }

  // 8. Emit Kafka event for downstream services
  await kafka.publish(
    KAFKA_TOPIC_REFERRAL_CONVERTED,
    conversion.id,
    {
      conversionId: conversion.id,
      referrerId: link.userId,
      referredUserId: payload.referredUserId,
      orderId: payload.orderId,
      orderAmountHalire: payload.orderAmountHalire,
      earnedHalire,
      occurredAt: conversion.createdAt.toISOString(),
    },
  );

  // 9. Update link aggregate stats
  await db.execute(
    `UPDATE referral.links
     SET total_conversions   = total_conversions + 1,
         total_earned_halire = total_earned_halire + $1
     WHERE id = $2`,
    [earnedHalire, link.id],
  );

  return conversion;
}

/**
 * Confirm a pending conversion (called 14 days after purchase).
 * Transitions status pending → confirmed.
 */
export async function confirmConversion(
  conversionId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE referral.conversions
     SET status = 'confirmed', confirmed_at = NOW()
     WHERE id = $1 AND status = 'pending'`,
    [conversionId],
  );
}

/**
 * Cancel a conversion (e.g. refund). Deducts the previously credited amount
 * from the referrer's wallet via a negative credit transaction.
 */
export async function cancelConversion(
  orderId: string,
  db: DbAdapter,
): Promise<void> {
  const row = await db.queryOne<ConversionRow & { referrer_user_id?: string }>(
    `SELECT c.*, l.user_id AS referrer_user_id
     FROM referral.conversions c
     JOIN referral.links l ON l.id = c.link_id
     WHERE c.order_id = $1 AND c.status IN ('pending', 'confirmed')`,
    [orderId],
  );

  if (!row) {
    // Already cancelled or non-existent — idempotent no-op
    return;
  }

  const conversion = mapRow(row);
  const referrerId = (row as ConversionRow & { referrer_user_id: string })
    .referrer_user_id;

  // Mark conversion cancelled
  await db.execute(
    `UPDATE referral.conversions
     SET status = 'cancelled'
     WHERE id = $1`,
    [conversion.id],
  );

  // Reverse the credit: insert a negative transaction (manual_adjustment)
  await db.execute(
    `INSERT INTO referral.credit_transactions
       (user_id, amount_halire, type, reference_id, description)
     VALUES ($1, $2, 'manual_adjustment', $3, $4)`,
    [
      referrerId,
      -conversion.earnedHalire,
      conversion.id,
      `Reversal: refund for order ${orderId}`,
    ],
  );

  // Update wallet balance (floor at 0 via DB CHECK constraint)
  await db.execute(
    `UPDATE referral.credit_wallet
     SET balance_halire = GREATEST(0, balance_halire - $1),
         updated_at     = NOW()
     WHERE user_id = $2`,
    [conversion.earnedHalire, referrerId],
  );

  // Reverse the link aggregate
  await db.execute(
    `UPDATE referral.links
     SET total_conversions   = GREATEST(0, total_conversions - 1),
         total_earned_halire = GREATEST(0, total_earned_halire - $1)
     WHERE id = $2`,
    [conversion.earnedHalire, conversion.linkId],
  );
}

/**
 * Return all conversions for a given referral link.
 */
export async function getConversionsForLink(
  linkId: string,
  db: DbAdapter,
): Promise<ReferralConversion[]> {
  const rows = await db.query<ConversionRow>(
    `SELECT * FROM referral.conversions
     WHERE link_id = $1
     ORDER BY created_at DESC`,
    [linkId],
  );
  return rows.map(mapRow);
}
