// =============================================================================
// AI Fraud Detection — types
// =============================================================================

export type AnomalyType =
  | 'velocity_spike'
  | 'price_outlier'
  | 'time_outlier'
  | 'amount_outlier'
  | 'duplicate_card'
  | 'shared_device_cluster'
  | 'circular_refund'
  | 'rapid_account_creation'
  | 'geographic_jump';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface AnomalySignal {
  type: AnomalyType;
  severity: Severity;
  /** 0-100 confidence */
  confidence: number;
  description: string;
  /** Linked entity ids for forensics */
  linkedEntityIds: string[];
  detectedAt: Date;
}

export type SubjectType = 'order' | 'user' | 'device';

export type Recommendation = 'allow' | 'review' | 'block';

export interface FraudReport {
  subjectType: SubjectType;
  subjectId: string;
  signals: AnomalySignal[];
  /** Combined risk score 0-100 */
  totalScore: number;
  /** Recommendation */
  recommendation: Recommendation;
}

export interface AnomalyDetectorConfig {
  /** Threshold above which a case is auto-pushed to fraud-queue */
  reviewThreshold: number;
  blockThreshold: number;
  /** Lookback window for velocity / clustering checks (hours) */
  lookbackHours: number;
}

export const DEFAULT_DETECTOR_CONFIG: AnomalyDetectorConfig = {
  reviewThreshold: 50,
  blockThreshold: 80,
  lookbackHours: 24,
};

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  low: 10,
  medium: 25,
  high: 50,
  critical: 100,
};
