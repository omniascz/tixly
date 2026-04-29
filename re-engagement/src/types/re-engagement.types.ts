// ─── Dormancy levels ──────────────────────────────────────────────────────────

/**
 * Dormancy classification by days since last purchase:
 *   at_risk  → 60–89 days
 *   dormant  → 90–179 days
 *   churned  → 180+ days
 */
export type DormancyLevel = 'at_risk' | 'dormant' | 'churned';

// ─── Campaign steps ───────────────────────────────────────────────────────────

export type CampaignChannel = 'email' | 'push';

export interface CampaignStep {
  /** Days after campaignStartedAt when this step should be sent. */
  day: number;
  channel: CampaignChannel;
  templateId: string;
}

/**
 * Default campaign schedule for the 'dormant' level.
 * Other levels may override; the service always uses this constant unless
 * extended in future iterations.
 *
 *   D+0  → email   (initial re-engagement)
 *   D+3  → push    (reminder nudge)
 *   D+7  → email   (final incentive)
 */
export const CAMPAIGN_STEPS: CampaignStep[] = [
  { day: 0, channel: 'email', templateId: 're-engagement-d0' },
  { day: 3, channel: 'push',  templateId: 're-engagement-d3' },
  { day: 7, channel: 'email', templateId: 're-engagement-d7' },
];

// ─── Campaign record ──────────────────────────────────────────────────────────

export type CampaignStatus = 'active' | 'completed' | 'converted' | 'unsubscribed';

export interface ReEngagementRecord {
  id: string;
  userId: string;
  dormancyLevel: DormancyLevel;
  campaignStartedAt: Date;
  /** Timestamp of the last step that was sent, or null if no step sent yet. */
  lastStepSentAt: Date | null;
  /** Index into CAMPAIGN_STEPS of the next step to send (0-based). */
  currentStep: number;
  status: CampaignStatus;
  /** Churn score 0–100: 0 = low risk, 100 = certain churn. */
  churnScore: number;
}

// ─── Adapter interfaces (dependency injection) ────────────────────────────────

import type { DbAdapter as BaseDbAdapter } from '@tixly/db-adapter';

export interface DbAdapter extends BaseDbAdapter {
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

export interface KafkaProducerAdapter {
  produce(topic: string, key: string, value: unknown): Promise<void>;
}

export interface EmailAdapter {
  send(opts: {
    userId: string;
    templateId: string;
    churnScore: number;
    dormancyLevel: DormancyLevel;
  }): Promise<void>;
}

export interface PushAdapter {
  send(opts: {
    userId: string;
    templateId: string;
    churnScore: number;
    dormancyLevel: DormancyLevel;
  }): Promise<void>;
}

// ─── Service dependencies ─────────────────────────────────────────────────────

export interface ServiceDeps {
  db: DbAdapter;
  kafka: KafkaProducerAdapter;
  email: EmailAdapter;
  push: PushAdapter;
}

// ─── Kafka event payloads ─────────────────────────────────────────────────────

export interface ReEngagementStepSentPayload {
  recordId: string;
  userId: string;
  step: CampaignStep;
  stepIndex: number;
  churnScore: number;
  dormancyLevel: DormancyLevel;
  sentAt: string;
}

export interface ReEngagementConvertedPayload {
  userId: string;
  convertedAt: string;
}

export interface ReEngagementUnsubscribedPayload {
  userId: string;
  unsubscribedAt: string;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class ReEngagementError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly userId?: string,
  ) {
    super(message);
    this.name = 'ReEngagementError';
  }
}

export class AlreadyInCampaignError extends ReEngagementError {
  constructor(userId: string) {
    super(
      `User already has an active re-engagement campaign: userId=${userId}`,
      'ALREADY_IN_CAMPAIGN',
      userId,
    );
    this.name = 'AlreadyInCampaignError';
  }
}

export class UserUnsubscribedError extends ReEngagementError {
  constructor(userId: string) {
    super(
      `User has unsubscribed from re-engagement campaigns: userId=${userId}`,
      'USER_UNSUBSCRIBED',
      userId,
    );
    this.name = 'UserUnsubscribedError';
  }
}

export class RecordNotFoundError extends ReEngagementError {
  constructor(recordId: string) {
    super(
      `Re-engagement record not found: recordId=${recordId}`,
      'RECORD_NOT_FOUND',
    );
    this.name = 'RecordNotFoundError';
  }
}
