/**
 * re-engagement.service.ts
 *
 * Orchestrates the automated email+push re-engagement campaign series
 * for dormant users (90+ days without a purchase).
 *
 * All public functions accept a `ServiceDeps` bag for full testability
 * via mock adapters. Each function wraps its DB work in withTenantContext
 * (local stub — replace with the shared RLS helper when available).
 */

import { getDormancyLevel } from '../lib/dormancy';
import {
  CAMPAIGN_STEPS,
  AlreadyInCampaignError,
  RecordNotFoundError,
  UserUnsubscribedError,
} from '../types/re-engagement.types';
import type {
  DormancyLevel,
  ReEngagementRecord,
  ReEngagementStepSentPayload,
  ReEngagementConvertedPayload,
  ReEngagementUnsubscribedPayload,
  ServiceDeps,
} from '../types/re-engagement.types';
import { withTenantContext } from '@tixly/rls-multitenancy';

// ─── DB row shape (internal) ──────────────────────────────────────────────────

interface ReEngagementRow {
  id: string;
  user_id: string;
  dormancy_level: DormancyLevel;
  campaign_started_at: string;
  last_step_sent_at: string | null;
  current_step: number;
  status: ReEngagementRecord['status'];
  churn_score: number;
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function rowToRecord(row: ReEngagementRow): ReEngagementRecord {
  return {
    id: row.id,
    userId: row.user_id,
    dormancyLevel: row.dormancy_level,
    campaignStartedAt: new Date(row.campaign_started_at),
    lastStepSentAt: row.last_step_sent_at ? new Date(row.last_step_sent_at) : null,
    currentStep: row.current_step,
    status: row.status,
    churnScore: row.churn_score,
  };
}

// ─── Kafka helpers ────────────────────────────────────────────────────────────

const KAFKA_TOPIC_STEP_SENT    = 're-engagement.step-sent';
const KAFKA_TOPIC_CONVERTED    = 're-engagement.converted';
const KAFKA_TOPIC_UNSUBSCRIBED = 're-engagement.unsubscribed';

/** Fire-and-forget: never awaited in the hot path, errors are logged only. */
function fireAndForget(promise: Promise<void>, label: string): void {
  promise.catch((err) =>
    console.error(`[re-engagement] Kafka fire-and-forget failed (${label}):`, err),
  );
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Starts a new re-engagement campaign for a user.
 *
 * - Idempotent: uses ON CONFLICT DO NOTHING so duplicate inserts are safe.
 * - Throws AlreadyInCampaignError if the user already has a non-terminal
 *   active campaign (callers that want idempotency should catch this).
 * - Throws UserUnsubscribedError if the user has previously unsubscribed.
 * - Does nothing (returns null) if the user's dormancy level is below the
 *   minimum threshold (getDormancyLevel returned null).
 */
export async function startCampaign(
  deps: ServiceDeps,
  userId: string,
  churnScore: number,
  lastPurchaseAt: Date,
  now: Date = new Date(),
): Promise<ReEngagementRecord | null> {
  const dormancyLevel = getDormancyLevel(lastPurchaseAt, now);
  if (dormancyLevel === null) {
    return null; // user is still active — no campaign needed
  }

  return withTenantContext(userId, async () => {
    const { db } = deps;

    // Check for existing unsubscribe record (GDPR: always respected)
    // Primárně kontrolujeme dedikovanou tabulku unsubscribes (přežije i smazání kampaní)
    const unsubRow = await db.queryOne<{ user_id: string }>(
      `SELECT user_id FROM marketing.re_engagement_unsubscribes
       WHERE user_id = $1
       LIMIT 1`,
      [userId],
    );
    if (unsubRow !== null) {
      throw new UserUnsubscribedError(userId);
    }

    // Check for existing active campaign
    const activeRow = await db.queryOne<{ id: string }>(
      `SELECT id FROM marketing.re_engagement_campaigns
       WHERE user_id = $1 AND status = 'active'
       LIMIT 1`,
      [userId],
    );
    if (activeRow !== null) {
      throw new AlreadyInCampaignError(userId);
    }

    // Cooldown check: don't spam the same user within 30 days
    // If user has completed/converted campaign with last_step_sent_at > NOW() - INTERVAL '30 days'
    const recentCampaignRow = await db.queryOne<{ id: string }>(
      `SELECT id FROM marketing.re_engagement_campaigns
       WHERE user_id = $1
         AND status IN ('completed', 'converted')
         AND last_step_sent_at > NOW() - INTERVAL '30 days'
       LIMIT 1`,
      [userId],
    );
    if (recentCampaignRow !== null) {
      // Cooldown active — don't start new campaign
      return null;
    }

    // Insert new campaign — ON CONFLICT DO NOTHING for idempotency in
    // concurrent batch scenarios (e.g., two cron runs overlapping).
    const rows = await db.query<ReEngagementRow>(
      `INSERT INTO marketing.re_engagement_campaigns
         (user_id, dormancy_level, campaign_started_at, last_step_sent_at,
          current_step, status, churn_score)
       VALUES ($1, $2, $3, NULL, 0, 'active', $4)
       ON CONFLICT (user_id, status) WHERE status = 'active' DO NOTHING
       RETURNING
         id, user_id, dormancy_level, campaign_started_at,
         last_step_sent_at, current_step, status, churn_score`,
      [userId, dormancyLevel, now.toISOString(), churnScore],
    );

    const row = rows[0];
    if (row === undefined) {
      // Conflict occurred — another concurrent insert won; fetch existing row.
      const existingRow = await db.queryOne<ReEngagementRow>(
        `SELECT id, user_id, dormancy_level, campaign_started_at,
                last_step_sent_at, current_step, status, churn_score
         FROM marketing.re_engagement_campaigns
         WHERE user_id = $1 AND status = 'active'`,
        [userId],
      );
      if (existingRow === null) {
        // Should not happen; guard for type safety.
        throw new AlreadyInCampaignError(userId);
      }
      return rowToRecord(existingRow);
    }

    return rowToRecord(row);
  });
}

/**
 * Sends the next scheduled campaign step for a given record.
 *
 * - Dispatches the appropriate email or push notification via the injected adapter.
 * - Advances currentStep; if all steps are exhausted sets status = 'completed'.
 * - Emits a Kafka event (fire-and-forget).
 */
export async function sendNextStep(
  deps: ServiceDeps,
  recordId: string,
  now: Date = new Date(),
): Promise<ReEngagementRecord> {
  const { db, kafka, email, push } = deps;

  const row = await db.queryOne<ReEngagementRow>(
    `SELECT id, user_id, dormancy_level, campaign_started_at,
            last_step_sent_at, current_step, status, churn_score
     FROM marketing.re_engagement_campaigns
     WHERE id = $1`,
    [recordId],
  );

  if (row === null) {
    throw new RecordNotFoundError(recordId);
  }

  const record = rowToRecord(row);

  if (record.status === 'unsubscribed') {
    throw new UserUnsubscribedError(record.userId);
  }

  if (record.status !== 'active') {
    // Already completed / converted — nothing to send.
    return record;
  }

  const step = CAMPAIGN_STEPS[record.currentStep];
  if (step === undefined) {
    // No steps left — mark completed.
    await db.execute(
      `UPDATE marketing.re_engagement_campaigns
       SET status = 'completed'
       WHERE id = $1`,
      [recordId],
    );
    return { ...record, status: 'completed' };
  }

  // Dispatch notification
  const sendOpts = {
    userId: record.userId,
    templateId: step.templateId,
    churnScore: record.churnScore,
    dormancyLevel: record.dormancyLevel,
  };

  if (step.channel === 'email') {
    await email.send(sendOpts);
  } else {
    await push.send(sendOpts);
  }

  const nextStepIndex = record.currentStep + 1;
  const allDone = nextStepIndex >= CAMPAIGN_STEPS.length;
  const newStatus: ReEngagementRecord['status'] = allDone ? 'completed' : 'active';

  // Persist advancement
  await db.execute(
    `UPDATE marketing.re_engagement_campaigns
     SET last_step_sent_at = $1,
         current_step      = $2,
         status            = $3
     WHERE id = $4`,
    [now.toISOString(), nextStepIndex, newStatus, recordId],
  );

  const sentAt = now.toISOString();

  // Kafka — fire-and-forget
  const payload: ReEngagementStepSentPayload = {
    recordId,
    userId: record.userId,
    step,
    stepIndex: record.currentStep,
    churnScore: record.churnScore,
    dormancyLevel: record.dormancyLevel,
    sentAt,
  };
  fireAndForget(
    kafka.produce(KAFKA_TOPIC_STEP_SENT, record.userId, payload),
    'step-sent',
  );

  return {
    ...record,
    lastStepSentAt: now,
    currentStep: nextStepIndex,
    status: newStatus,
  };
}

/**
 * Marks all active campaigns for a user as 'converted'.
 *
 * Called when the user completes a purchase. Emits a Kafka event.
 */
export async function markConverted(
  deps: ServiceDeps,
  userId: string,
): Promise<void> {
  const { db, kafka } = deps;

  await withTenantContext(userId, async () => {
    await db.execute(
      `UPDATE marketing.re_engagement_campaigns
       SET status = 'converted'
       WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );
  });

  const payload: ReEngagementConvertedPayload = {
    userId,
    convertedAt: new Date().toISOString(),
  };
  fireAndForget(
    kafka.produce(KAFKA_TOPIC_CONVERTED, userId, payload),
    'converted',
  );
}

/**
 * Unsubscribes a user from all re-engagement campaigns.
 *
 * GDPR requirement: must work regardless of current campaign status,
 * including for active campaigns. Sets status = 'unsubscribed' on all
 * non-terminal campaigns. Emits a Kafka event.
 */
export async function unsubscribe(
  deps: ServiceDeps,
  userId: string,
): Promise<void> {
  const { db, kafka } = deps;

  await withTenantContext(userId, async () => {
    await db.execute(
      `UPDATE marketing.re_engagement_campaigns
       SET status = 'unsubscribed'
       WHERE user_id = $1
         AND status NOT IN ('converted', 'unsubscribed')`,
      [userId],
    );

    // Persist unsubscribe preference so future startCampaign calls are blocked.
    await db.execute(
      `INSERT INTO marketing.re_engagement_unsubscribes (user_id, unsubscribed_at)
       VALUES ($1, NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );
  });

  const payload: ReEngagementUnsubscribedPayload = {
    userId,
    unsubscribedAt: new Date().toISOString(),
  };
  fireAndForget(
    kafka.produce(KAFKA_TOPIC_UNSUBSCRIBED, userId, payload),
    'unsubscribed',
  );
}

/**
 * Cron batch runner.
 *
 * Finds all active campaign records where the next step is due
 * (lastStepSentAt + step.day * 86400s <= now, or campaignStartedAt for step 0)
 * and calls sendNextStep for each.
 *
 * Errors from individual records are logged but do not abort the batch.
 */
export async function runCampaignBatch(
  deps: ServiceDeps,
  now: Date = new Date(),
): Promise<{ processed: number; failed: number }> {
  const { db } = deps;

  // We need to find records where the NEXT step (current_step) is due.
  // For step 0 (not yet sent): due when campaignStartedAt + 0 days <= now,
  //   i.e. immediately once the campaign is started.
  // For steps 1+: due when lastStepSentAt + step.day_delta days <= now,
  //   where day_delta = step[currentStep].day - step[currentStep-1].day.
  //
  // Simplest correct approach: fetch all active records and filter in JS
  // using CAMPAIGN_STEPS, keeping the DB query straightforward.
  const rows = await db.query<ReEngagementRow>(
    `SELECT id, user_id, dormancy_level, campaign_started_at,
            last_step_sent_at, current_step, status, churn_score
     FROM marketing.re_engagement_campaigns
     WHERE status = 'active'
     ORDER BY campaign_started_at ASC`,
  );

  const nowMs = now.getTime();
  const MS_PER_DAY = 1000 * 60 * 60 * 24;

  const due = rows.filter((row) => {
    const step = CAMPAIGN_STEPS[row.current_step];
    if (step === undefined) return false; // all steps done — shouldn't be active

    if (row.current_step === 0) {
      // Step 0: send as soon as campaign is started (day offset = 0).
      // Due when campaignStartedAt + step.day days <= now.
      const dueMs = new Date(row.campaign_started_at).getTime() + step.day * MS_PER_DAY;
      return dueMs <= nowMs;
    }

    // Subsequent steps: due relative to when the previous step was sent.
    if (row.last_step_sent_at === null) return false;

    // The day offset on step N is absolute from campaignStartedAt, not delta.
    const dueMs = new Date(row.campaign_started_at).getTime() + step.day * MS_PER_DAY;
    return dueMs <= nowMs;
  });

  let processed = 0;
  let failed = 0;

  for (const row of due) {
    try {
      await sendNextStep(deps, row.id, now);
      processed++;
    } catch (err) {
      failed++;
      console.error(
        `[re-engagement] runCampaignBatch: failed to process recordId=${row.id}:`,
        err,
      );
    }
  }

  return { processed, failed };
}
