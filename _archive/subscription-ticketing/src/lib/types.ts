// ============================================================
// Subscription Ticketing — Type Definitions
// Netflix-model: monthly fee → access to N events/month
// ============================================================

export type BillingPeriod = 'monthly' | 'annual';
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled' | 'expired' | 'pending_payment';
export type RedemptionStatus = 'used' | 'refunded';

// ─── Plan ────────────────────────────────────────────────────

export interface SubscriptionPlan {
  id: string;
  name: string;
  /** Human-readable description */
  description: string;
  billingPeriod: BillingPeriod;
  /** Price in INTEGER halíře (1 Kč = 100 halířů) */
  priceHalire: number;
  /** Max event redemptions per billing period (e.g. 2 per month) */
  eventsPerPeriod: number;
  /** Organizer that created this plan; null = platform-wide plan */
  organizerId: string | null;
  active: boolean;
  createdAt: Date;
}

// ─── Subscription ────────────────────────────────────────────

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  /** Remaining redemptions for current period */
  remainingRedemptions: number;
  /** GoPay recurring token (set after first successful payment) */
  gopayRecurringToken?: string;
  gopayPaymentId?: string;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Redemption ──────────────────────────────────────────────

export interface SubscriptionRedemption {
  id: string;
  subscriptionId: string;
  userId: string;
  eventId: string;
  orderId: string;
  status: RedemptionStatus;
  redeemedAt: Date;
}

// ─── Commands ────────────────────────────────────────────────

export interface CreateSubscriptionOptions {
  userId: string;
  planId: string;
  gopayPaymentId?: string;
  gopayRecurringToken?: string;
}

export interface RedeemEventOptions {
  subscriptionId: string;
  userId: string;
  eventId: string;
  orderId: string;
}

export interface RenewSubscriptionOptions {
  subscriptionId: string;
  gopayPaymentId: string;
}

// ─── DB Adapter ──────────────────────────────────────────────

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
  execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

// ─── Errors ──────────────────────────────────────────────────

export class SubscriptionNotFoundError extends Error {
  constructor(id: string) {
    super(`Subscription not found: ${id}`);
    this.name = 'SubscriptionNotFoundError';
  }
}

export class SubscriptionInactiveError extends Error {
  constructor(status: SubscriptionStatus) {
    super(`Subscription is not active (status: ${status})`);
    this.name = 'SubscriptionInactiveError';
  }
}

export class NoRedemptionsRemainingError extends Error {
  constructor() {
    super('No event redemptions remaining in current billing period');
    this.name = 'NoRedemptionsRemainingError';
  }
}

export class PlanNotFoundError extends Error {
  constructor(id: string) {
    super(`Subscription plan not found: ${id}`);
    this.name = 'PlanNotFoundError';
  }
}

export class DuplicateRedemptionError extends Error {
  constructor(eventId: string) {
    super(`Event already redeemed in this period: ${eventId}`);
    this.name = 'DuplicateRedemptionError';
  }
}
