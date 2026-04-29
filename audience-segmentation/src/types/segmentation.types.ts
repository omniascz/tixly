// ─── Filter types ─────────────────────────────────────────────────────────────

export type FilterType =
  | "geographic"
  | "behavioral"
  | "rfm"
  | "purchase_history"
  | "loyalty_tier";

export interface GeographicFilter {
  city?: string[];
  region?: string[];
  country?: string[];
}

export interface BehavioralFilter {
  minPurchases?: number;
  maxPurchases?: number;
  firstTimeBuyer?: boolean;
  repeatingBuyer?: boolean;
  attendedEventIds?: string[];
}

/**
 * RFM filter.
 * - recencyDays: user must have purchased within the last N days
 * - minFrequency: minimum total order count
 * - minMonetaryValue: minimum lifetime spend in haléře (INTEGER, e.g. 50000 = 500 Kč)
 */
export interface RfmFilter {
  recencyDays?: number;
  minFrequency?: number;
  minMonetaryValue?: number;
}

export type LoyaltyTier = "bronze" | "silver" | "gold" | "platinum";

export interface LoyaltyTierFilter {
  tiers: LoyaltyTier[];
}

// ─── Composite filter ─────────────────────────────────────────────────────────

export interface SegmentFilter {
  geographic?: GeographicFilter;
  behavioral?: BehavioralFilter;
  rfm?: RfmFilter;
  loyaltyTier?: LoyaltyTierFilter;
}

// ─── Core domain types ────────────────────────────────────────────────────────

export interface Segment {
  id: string;
  promoterId: string;
  name: string;
  /** Stored as JSONB in the database. */
  filter: SegmentFilter;
  /** COUNT(*) result from the last estimation run. */
  estimatedSize: number;
  createdAt: string;
  lastRefreshedAt: string;
}

export interface SegmentMember {
  userId: string;
  email: string;
  firstName: string | null;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class SegmentNotFoundError extends Error {
  constructor(public readonly segmentId: string) {
    super(`Segment not found: segmentId=${segmentId}`);
    this.name = "SegmentNotFoundError";
  }
}

export class InvalidFilterError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "InvalidFilterError";
  }
}
