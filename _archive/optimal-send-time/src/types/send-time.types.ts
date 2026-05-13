/**
 * Optimal Send Time — TypeScript types
 * Tixly, 2026
 */

// ---------------------------------------------------------------------------
// Core Bayesian model types
// ---------------------------------------------------------------------------

export interface BetaDistribution {
  /** α parameter — number of successes (opens/clicks) */
  alpha: number;
  /** β parameter — number of failures (delivered but not opened) */
  beta: number;
  /** Posterior mean = α / (α + β) */
  posteriorMean: number;
  /** Total observations that shaped this distribution */
  sampleSize: number;
}

/** hour (0–23) → normalised probability, all values sum to 1.0 */
export type HourDistribution = Record<number, number>;

/** day-of-week (0=Monday … 6=Sunday) → normalised probability, sum = 1.0 */
export type DayDistribution = Record<number, number>;

// ---------------------------------------------------------------------------
// DB row types  (mirror of ai.user_send_times / ai.email_engagement_log)
// ---------------------------------------------------------------------------

export interface UserSendTime {
  userId: string;
  bestSendHour: number;          // 0–23
  bestSendDay: number;           // 0–6  (0 = Monday)
  confidence: number;            // 0–1
  hourDistribution: HourDistribution;
  dayDistribution: DayDistribution;
  dataPoints: number;
  isCohortFallback: boolean;
  modelVersion: string;
  computedAt: string;            // ISO 8601 / TIMESTAMPTZ
}

export type EngagementEventType =
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'unsubscribed'
  | 'complained';

export interface EmailEngagementEvent {
  id?: string;
  userId: string;
  messageId: string;
  eventType: EngagementEventType;
  occurredAt: string;            // ISO 8601
  hourOfDay: number;             // 0–23
  dayOfWeek: number;             // 0–6
  campaignId?: string;
  subjectLine?: string;
  createdAt?: string;
}

// ---------------------------------------------------------------------------
// API / service layer types
// ---------------------------------------------------------------------------

export interface SendTimeRecommendation {
  userId: string;
  bestHour: number;
  bestDay: number;
  confidence: number;
  hourDistribution: HourDistribution;
  dayDistribution: DayDistribution;
  isCohortFallback: boolean;
}

export interface BatchSendTimeRequest {
  userIds: string[];
}

export interface BatchSendTimeResponse {
  sendTimes: SendTimeRecommendation[];
  processedAt: string;
}

// ---------------------------------------------------------------------------
// Mailgun webhook payload (relevant subset)
// ---------------------------------------------------------------------------

export interface MailgunWebhookPayload {
  signature: {
    timestamp: string;
    token: string;
    signature: string;
  };
  'event-data': {
    event: string;              // 'delivered' | 'opened' | 'clicked' | …
    id: string;
    timestamp: number;          // Unix epoch (seconds)
    message: {
      headers: {
        'message-id': string;
        subject?: string;
      };
    };
    recipient?: string;
    tags?: string[];
    'user-variables'?: Record<string, string>;
    campaigns?: Array<{ name: string; id: string }>;
  };
}

// ---------------------------------------------------------------------------
// Adapter interfaces (Dependency Injection)
// ---------------------------------------------------------------------------

export type { DbAdapter } from '@tixly/db-adapter';
import type { DbAdapter } from '@tixly/db-adapter';

export interface RedisAdapter {
  /** Returns null on cache miss */
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Execute multiple GETs in a single round-trip; returns array of results */
  mget(keys: string[]): Promise<Array<string | null>>;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class MailgunSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailgunSignatureError';
  }
}

export class UserNotFoundError extends Error {
  readonly userId: string;
  constructor(userId: string) {
    super(`User not found: ${userId}`);
    this.name = 'UserNotFoundError';
    this.userId = userId;
  }
}

export class BatchTooLargeError extends Error {
  readonly requested: number;
  readonly limit: number;
  constructor(requested: number, limit: number) {
    super(`Batch size ${requested} exceeds limit of ${limit}`);
    this.name = 'BatchTooLargeError';
    this.requested = requested;
    this.limit = limit;
  }
}
