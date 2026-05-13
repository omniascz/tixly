// subscription.service.ts — Netflix-model subscription ticketing
// Monthly plan → N event redemptions per billing period.
// Atomic decrement prevents double-redemption under concurrency.

import type {
  DbAdapter,
  SubscriptionPlan,
  Subscription,
  SubscriptionRedemption,
  CreateSubscriptionOptions,
  RedeemEventOptions,
  RenewSubscriptionOptions,
  SubscriptionStatus,
} from '../lib/types';
import {
  SubscriptionNotFoundError,
  SubscriptionInactiveError,
  NoRedemptionsRemainingError,
  PlanNotFoundError,
  DuplicateRedemptionError,
} from '../lib/types';

// ─── Internal DB row types ────────────────────────────────────

interface PlanRow {
  id: string;
  name: string;
  description: string;
  billing_period: string;
  price_halire: number;
  events_per_period: number;
  organizer_id: string | null;
  active: boolean;
  created_at: string;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  remaining_redemptions: number;
  gopay_recurring_token: string | null;
  gopay_payment_id: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RedemptionRow {
  id: string;
  subscription_id: string;
  user_id: string;
  event_id: string;
  order_id: string;
  status: string;
  redeemed_at: string;
}

// ─── Mappers ─────────────────────────────────────────────────

function mapPlan(row: PlanRow): SubscriptionPlan {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    billingPeriod: row.billing_period as 'monthly' | 'annual',
    priceHalire: row.price_halire,
    eventsPerPeriod: row.events_per_period,
    organizerId: row.organizer_id,
    active: row.active,
    createdAt: new Date(row.created_at),
  };
}

function mapSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    status: row.status as SubscriptionStatus,
    currentPeriodStart: new Date(row.current_period_start),
    currentPeriodEnd: new Date(row.current_period_end),
    remainingRedemptions: row.remaining_redemptions,
    gopayRecurringToken: row.gopay_recurring_token ?? undefined,
    gopayPaymentId: row.gopay_payment_id ?? undefined,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapRedemption(row: RedemptionRow): SubscriptionRedemption {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    userId: row.user_id,
    eventId: row.event_id,
    orderId: row.order_id,
    status: row.status as 'used' | 'refunded',
    redeemedAt: new Date(row.redeemed_at),
  };
}

// ─── computePeriodEnd ─────────────────────────────────────────

function computePeriodEnd(start: Date, billingPeriod: 'monthly' | 'annual'): Date {
  const end = new Date(start);
  if (billingPeriod === 'monthly') {
    end.setMonth(end.getMonth() + 1);
  } else {
    end.setFullYear(end.getFullYear() + 1);
  }
  return end;
}

// ─── getPlan ─────────────────────────────────────────────────

export async function getPlan(planId: string, db: DbAdapter): Promise<SubscriptionPlan> {
  const row = await db.queryOne<PlanRow>(
    `SELECT id, name, description, billing_period, price_halire, events_per_period,
            organizer_id, active, created_at
     FROM subscriptions.plans WHERE id = $1`,
    [planId],
  );
  if (!row) throw new PlanNotFoundError(planId);
  return mapPlan(row);
}

// ─── listPlans ────────────────────────────────────────────────

export async function listPlans(
  db: DbAdapter,
  organizerId?: string,
): Promise<SubscriptionPlan[]> {
  const rows = organizerId
    ? await db.query<PlanRow>(
        `SELECT * FROM subscriptions.plans
         WHERE active = true AND (organizer_id = $1 OR organizer_id IS NULL)
         ORDER BY price_halire ASC`,
        [organizerId],
      )
    : await db.query<PlanRow>(
        `SELECT * FROM subscriptions.plans WHERE active = true ORDER BY price_halire ASC`,
      );
  return rows.map(mapPlan);
}

// ─── createSubscription ───────────────────────────────────────

/**
 * Subscribe user to a plan.
 * Sets current period dates and seeds remaining_redemptions from plan.
 */
export async function createSubscription(
  opts: CreateSubscriptionOptions,
  db: DbAdapter,
): Promise<Subscription> {
  return db.transaction(async (tx) => {
    const plan = await getPlan(opts.planId, tx);
    if (!plan.active) throw new PlanNotFoundError(opts.planId);

    const now = new Date();
    const periodEnd = computePeriodEnd(now, plan.billingPeriod);

    const rows = await tx.query<SubscriptionRow>(
      `INSERT INTO subscriptions.subscriptions
         (user_id, plan_id, status, current_period_start, current_period_end,
          remaining_redemptions, gopay_recurring_token, gopay_payment_id,
          created_at, updated_at)
       VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING *`,
      [
        opts.userId,
        opts.planId,
        now,
        periodEnd,
        plan.eventsPerPeriod,
        opts.gopayRecurringToken ?? null,
        opts.gopayPaymentId ?? null,
      ],
    );

    return mapSubscription(rows[0]);
  });
}

// ─── getSubscription ──────────────────────────────────────────

export async function getSubscription(subscriptionId: string, db: DbAdapter): Promise<Subscription> {
  const row = await db.queryOne<SubscriptionRow>(
    `SELECT * FROM subscriptions.subscriptions WHERE id = $1`,
    [subscriptionId],
  );
  if (!row) throw new SubscriptionNotFoundError(subscriptionId);
  return mapSubscription(row);
}

// ─── listSubscriptionsForUser ─────────────────────────────────

export async function listSubscriptionsForUser(userId: string, db: DbAdapter): Promise<Subscription[]> {
  const rows = await db.query<SubscriptionRow>(
    `SELECT * FROM subscriptions.subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(mapSubscription);
}

// ─── redeemEvent ─────────────────────────────────────────────

/**
 * Use one redemption slot from active subscription for an event purchase.
 * Atomically decrements remaining_redemptions to prevent race conditions.
 * Idempotent: duplicate (subscriptionId, eventId) in same period is rejected.
 */
export async function redeemEvent(
  opts: RedeemEventOptions,
  db: DbAdapter,
): Promise<SubscriptionRedemption> {
  return db.transaction(async (tx) => {
    const sub = await getSubscription(opts.subscriptionId, tx);

    if (sub.status !== 'active') {
      throw new SubscriptionInactiveError(sub.status);
    }

    // Check for duplicate redemption in current period
    const existing = await tx.queryOne<{ id: string }>(
      `SELECT id FROM subscriptions.redemptions
       WHERE subscription_id = $1 AND event_id = $2
         AND redeemed_at >= $3 AND status = 'used'`,
      [opts.subscriptionId, opts.eventId, sub.currentPeriodStart],
    );
    if (existing) throw new DuplicateRedemptionError(opts.eventId);

    // Atomic decrement — WHERE remaining_redemptions > 0 prevents overselling
    const updated = await tx.queryOne<{ remaining_redemptions: number }>(
      `UPDATE subscriptions.subscriptions
       SET remaining_redemptions = remaining_redemptions - 1, updated_at = NOW()
       WHERE id = $1 AND remaining_redemptions > 0
       RETURNING remaining_redemptions`,
      [opts.subscriptionId],
    );
    if (!updated) throw new NoRedemptionsRemainingError();

    const rows = await tx.query<RedemptionRow>(
      `INSERT INTO subscriptions.redemptions
         (subscription_id, user_id, event_id, order_id, status, redeemed_at)
       VALUES ($1, $2, $3, $4, 'used', NOW())
       RETURNING *`,
      [opts.subscriptionId, opts.userId, opts.eventId, opts.orderId],
    );

    return mapRedemption(rows[0]);
  });
}

// ─── renewSubscription ────────────────────────────────────────

/**
 * Called by billing job when recurring payment succeeds.
 * Resets remaining_redemptions to plan quota and advances period dates.
 */
export async function renewSubscription(
  opts: RenewSubscriptionOptions,
  db: DbAdapter,
): Promise<Subscription> {
  return db.transaction(async (tx) => {
    const sub = await getSubscription(opts.subscriptionId, tx);
    const plan = await getPlan(sub.planId, tx);

    const newStart = sub.currentPeriodEnd;
    const newEnd = computePeriodEnd(newStart, plan.billingPeriod);

    const rows = await tx.query<SubscriptionRow>(
      `UPDATE subscriptions.subscriptions
       SET status = 'active',
           current_period_start = $1,
           current_period_end = $2,
           remaining_redemptions = $3,
           gopay_payment_id = $4,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [newStart, newEnd, plan.eventsPerPeriod, opts.gopayPaymentId, opts.subscriptionId],
    );

    return mapSubscription(rows[0]);
  });
}

// ─── cancelSubscription ───────────────────────────────────────

/**
 * Cancel at period end (access continues until currentPeriodEnd).
 */
export async function cancelSubscription(
  subscriptionId: string,
  userId: string,
  db: DbAdapter,
): Promise<Subscription> {
  return db.transaction(async (tx) => {
    const sub = await getSubscription(subscriptionId, tx);
    if (sub.userId !== userId) {
      throw new SubscriptionNotFoundError(subscriptionId);
    }
    if (sub.status === 'cancelled') {
      return sub;
    }

    const rows = await tx.query<SubscriptionRow>(
      `UPDATE subscriptions.subscriptions
       SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [subscriptionId],
    );

    return mapSubscription(rows[0]);
  });
}

// ─── expireSubscriptions ──────────────────────────────────────

/**
 * Cron job: mark subscriptions whose period_end has passed as expired.
 */
export async function expireSubscriptions(db: DbAdapter): Promise<number> {
  const result = await db.execute(
    `UPDATE subscriptions.subscriptions
     SET status = 'expired', updated_at = NOW()
     WHERE status IN ('active', 'paused')
       AND current_period_end < NOW()`,
  );
  return result.rowCount;
}

// ─── listRedemptions ─────────────────────────────────────────

export async function listRedemptions(
  subscriptionId: string,
  db: DbAdapter,
): Promise<SubscriptionRedemption[]> {
  const rows = await db.query<RedemptionRow>(
    `SELECT * FROM subscriptions.redemptions WHERE subscription_id = $1 ORDER BY redeemed_at DESC`,
    [subscriptionId],
  );
  return rows.map(mapRedemption);
}
