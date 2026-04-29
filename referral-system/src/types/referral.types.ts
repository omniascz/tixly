// ============================================================
// Referral System — Type Definitions
// ============================================================

// ─── Enums ───────────────────────────────────────────────────

export enum AttributionModel {
  LastClick = 'last_click',
  FirstClick = 'first_click',
  Linear = 'linear',
}

export enum ConversionStatus {
  Pending = 'pending',
  Confirmed = 'confirmed',
  Paid = 'paid',
  Cancelled = 'cancelled',
}

export enum CreditTransactionType {
  ReferralEarned = 'referral_earned',
  OrderDiscount = 'order_discount',
  Expired = 'expired',
  ManualAdjustment = 'manual_adjustment',
}

// ─── Domain entities ─────────────────────────────────────────

export interface ReferralLink {
  id: string;
  userId: string;
  code: string;
  campaignId: string | null;
  createdAt: Date;
  isActive: boolean;
  totalClicks: number;
  totalConversions: number;
  /** Celková zasloužená provize v haléřích (1 Kč = 100 haléřů). */
  totalEarnedHalire: number;
}

export interface ReferralClick {
  id: bigint;
  linkId: string;
  referrerCode: string;
  visitorId: string;
  sessionId: string;
  ipHash: string;
  userAgentHash: string;
  occurredAt: Date;
  converted: boolean;
  convertedAt: Date | null;
}

export interface ReferralConversion {
  id: string;
  linkId: string;
  clickId: bigint | null;
  orderId: string;
  referredUserId: string;
  /** Hodnota objednávky v haléřích. */
  orderAmountHalire: number;
  commissionRate: number;
  /** Vypočtená provize v haléřích. */
  earnedHalire: number;
  status: ConversionStatus;
  createdAt: Date;
  confirmedAt: Date | null;
  paidAt: Date | null;
}

export interface CreditWallet {
  userId: string;
  /** Aktuální zůstatek v haléřích. */
  balanceHalire: number;
  lifetimeEarnedHalire: number;
  lifetimeSpentHalire: number;
  updatedAt: Date;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  /** Kladná = earn, záporná = spend. Vždy v haléřích. */
  amountHalire: number;
  type: CreditTransactionType;
  referenceId: string | null;
  description: string;
  createdAt: Date;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string; // "Jan K."
  totalConversions: number;
  totalEarnedHalire: number;
}

// ─── Attribution helper types ─────────────────────────────────

export interface LinearAttributionShare {
  linkId: string;
  clickId: bigint;
  /** Share of commission in haléře. Integer; shares sum to total. */
  amountHalire: number;
}

// ─── Command / payload types ──────────────────────────────────

export interface CreateLinkOptions {
  campaignId?: string;
}

export interface TrackClickPayload {
  code: string;
  visitorId: string;
  sessionId: string;
  ip: string;            // raw IP — will be hashed before storage
  userAgent: string;     // raw UA — will be hashed before storage
}

export interface RecordConversionPayload {
  orderId: string;
  referredUserId: string;
  referrerCode: string;
  /** Celková hodnota objednávky v haléřích. */
  orderAmountHalire: number;
  visitorId: string;     // used to look up clicks for attribution
}

// ─── Typed errors ─────────────────────────────────────────────

export class ReferralCodeCollisionError extends Error {
  constructor(attempts: number) {
    super(`Failed to generate unique referral code after ${attempts} attempts`);
    this.name = 'ReferralCodeCollisionError';
  }
}

export class InsufficientCreditError extends Error {
  constructor(availableHalire: number, requestedHalire: number) {
    super(
      `Insufficient credit: available ${availableHalire} haléřů, requested ${requestedHalire} haléřů`,
    );
    this.name = 'InsufficientCreditError';
  }
}

export class SelfReferralError extends Error {
  constructor() {
    super('A user cannot refer themselves');
    this.name = 'SelfReferralError';
  }
}

export class LinkNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Referral link not found: ${identifier}`);
    this.name = 'LinkNotFoundError';
  }
}

// ─── Port interfaces (dependency injection) ──────────────────

import type { DbAdapter as BaseDbAdapter } from '@tixly/db-adapter';

export interface DbAdapter extends BaseDbAdapter {
  /**
   * Execute a query and return exactly one row, or null.
   */
  queryOne<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null>;
}

export interface KafkaProducerAdapter {
  /**
   * Publish a message to a Kafka topic.
   */
  publish(topic: string, key: string, value: unknown): Promise<void>;
}
