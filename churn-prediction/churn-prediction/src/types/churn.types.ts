// ─── Enums ────────────────────────────────────────────────────────────────────

export enum RetentionAction {
  None = "none",
  EmailReminder = "email_reminder",
  EmailDiscount = "email_discount",
  PushHighlight = "push_highlight",
  PhoneCall = "phone_call",
}

export type PredictionHorizon = "30d" | "14d" | "7d";

// ─── Feature types ────────────────────────────────────────────────────────────

/**
 * Raw (un-normalised) features as extracted from the database.
 * These are passed into normalizeFeatures() before model inference.
 */
export interface RawChurnFeatures {
  /**
   * Fraction of expected usages actually consumed so far.
   * For season passes: actual / expected_at_this_point (already [0,1]).
   * For flex passes:   (total_uses - remaining_uses) / total_uses.
   */
  usage_rate: number;

  /** Days since the last recorded usage (NOW() - MAX(used_at)). */
  days_since_last_usage: number;

  /**
   * Slope (days per visit) from a linear regression over the last ≤5
   * inter-visit intervals. Positive = gaps widening = churn signal.
   */
  usage_gap_trend: number;

  /**
   * Historical renewal rate for this organiser + pass type cohort (0–1).
   * Defaults to 0.65 when fewer than 10 samples exist.
   */
  cohort_renewal_rate: number;

  /** Total months the user has held any pass from this organiser. */
  months_as_subscriber: number;
}

/**
 * Normalised features — all values clamped to [0,1].
 * Produced by normalizeFeatures(raw: RawChurnFeatures).
 */
export interface ChurnFeatures {
  /** Already [0,1]. */
  usage_rate: number;

  /** Normalised: raw / 180 clamped to [0,1]. */
  days_since_last_usage: number;

  /** Normalised: (raw + 10) / 20 clamped to [0,1]. */
  usage_gap_trend: number;

  /** Already [0,1]. */
  cohort_renewal_rate: number;

  /** Normalised: raw / 60 clamped to [0,1]. */
  months_as_subscriber: number;
}

// ─── Feature importance ───────────────────────────────────────────────────────

export interface TopFeature {
  /** Feature name matching a key of ChurnFeatures. */
  name: keyof ChurnFeatures;
  /** Normalised feature value [0,1]. */
  value: number;
  /** Magnitude of this feature's contribution relative to the others. */
  impact: "high" | "medium" | "low";
  /** Whether this feature pushes churn probability up or down. */
  direction: "increases_churn" | "decreases_churn";
}

// ─── Prediction output ────────────────────────────────────────────────────────

export interface ChurnPrediction {
  id: string;
  passId: string;
  userId: string;
  churnProbability: number;
  topFeatures: TopFeature[];
  modelVersion: string;
  predictionHorizon: PredictionHorizon;
  retentionAction: RetentionAction;
  /** ISO timestamp of when this prediction was computed. */
  computedAt: string;
  /** ISO timestamp of when the retention action was dispatched, or null. */
  actionExecutedAt: string | null;
  /** 'renewed' | 'churned' — filled in after the pass expires. */
  actionResult: "renewed" | "churned" | null;
}

// ─── Cohort statistics ────────────────────────────────────────────────────────

export interface CohortStats {
  /** "${organizerId}:${passType}" */
  cohort_key: string;
  renewal_rate: number;
  sample_size: number;
}

// ─── Kafka event payload ──────────────────────────────────────────────────────

export interface ChurnScoredPayload {
  passId: string;
  userId: string;
  churnProbability: number;
  predictionHorizon: PredictionHorizon;
  retentionAction: RetentionAction;
  topFeatures: TopFeature[];
  computedAt: string;
}

// ─── Adapter interfaces (dependency injection) ────────────────────────────────

import type { DbAdapter as BaseDbAdapter } from '@tixly/db-adapter';

export interface DbAdapter extends BaseDbAdapter {
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

export interface KafkaProducerAdapter {
  produce(topic: string, key: string, value: unknown): Promise<void>;
}

// ─── Service dependencies ─────────────────────────────────────────────────────

export interface ServiceDeps {
  db: DbAdapter;
  kafka: KafkaProducerAdapter;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class ChurnScoringError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly passId?: string,
  ) {
    super(message);
    this.name = "ChurnScoringError";
  }
}

export class PassNotFoundError extends ChurnScoringError {
  constructor(passId: string) {
    super(
      `Season pass not found: passId=${passId}`,
      "PASS_NOT_FOUND",
      passId,
    );
    this.name = "PassNotFoundError";
  }
}

export class InsufficientUsageDataError extends ChurnScoringError {
  constructor(passId: string) {
    super(
      `Insufficient usage data to score pass: passId=${passId}`,
      "INSUFFICIENT_USAGE_DATA",
      passId,
    );
    this.name = "InsufficientUsageDataError";
  }
}
