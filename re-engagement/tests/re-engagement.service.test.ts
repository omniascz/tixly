import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  startCampaign,
  sendNextStep,
  markConverted,
  unsubscribe,
  runCampaignBatch,
} from '../src/services/re-engagement.service';
import {
  AlreadyInCampaignError,
  UserUnsubscribedError,
  RecordNotFoundError,
  CAMPAIGN_STEPS,
} from '../src/types/re-engagement.types';
import type {
  DbAdapter,
  EmailAdapter,
  KafkaProducerAdapter,
  PushAdapter,
  ServiceDeps,
} from '../src/types/re-engagement.types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date('2026-04-05T12:00:00.000Z');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

const DORMANT_LAST_PURCHASE = daysAgo(100); // 100 days → 'dormant'
const AT_RISK_LAST_PURCHASE = daysAgo(70);  // 70 days  → 'at_risk'
const CHURNED_LAST_PURCHASE = daysAgo(200); // 200 days → 'churned'
const ACTIVE_LAST_PURCHASE  = daysAgo(30);  // 30 days  → null (active)

const USER_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const RECORD_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeDbRow(overrides: Partial<{
  id: string;
  user_id: string;
  dormancy_level: string;
  campaign_started_at: string;
  last_step_sent_at: string | null;
  current_step: number;
  status: string;
  churn_score: number;
}> = {}) {
  return {
    id: RECORD_ID,
    user_id: USER_ID,
    dormancy_level: 'dormant',
    campaign_started_at: NOW.toISOString(),
    last_step_sent_at: null,
    current_step: 0,
    status: 'active',
    churn_score: 65,
    ...overrides,
  };
}

// ─── Mock factory ─────────────────────────────────────────────────────────────

function makeDeps(overrides: {
  queryOne?: DbAdapter['queryOne'];
  query?: DbAdapter['query'];
  execute?: DbAdapter['execute'];
  kafkaProduce?: KafkaProducerAdapter['produce'];
  emailSend?: EmailAdapter['send'];
  pushSend?: PushAdapter['send'];
} = {}): ServiceDeps {
  const db: DbAdapter = {
    query: overrides.query ?? vi.fn().mockResolvedValue([]),
    queryOne: overrides.queryOne ?? vi.fn().mockResolvedValue(null),
    execute: overrides.execute ?? vi.fn().mockResolvedValue({ rowsAffected: 1 }),
  };
  const kafka: KafkaProducerAdapter = {
    produce: overrides.kafkaProduce ?? vi.fn().mockResolvedValue(undefined),
  };
  const email: EmailAdapter = {
    send: overrides.emailSend ?? vi.fn().mockResolvedValue(undefined),
  };
  const push: PushAdapter = {
    send: overrides.pushSend ?? vi.fn().mockResolvedValue(undefined),
  };
  return { db, kafka, email, push };
}

// ─── startCampaign ────────────────────────────────────────────────────────────

describe('startCampaign', () => {
  it('returns null for an active user (< 60 days since purchase)', async () => {
    const deps = makeDeps();
    const result = await startCampaign(deps, USER_ID, 30, ACTIVE_LAST_PURCHASE, NOW);
    expect(result).toBeNull();
  });

  it('starts a campaign for a dormant user (100 days)', async () => {
    const row = makeDbRow();
    const deps = makeDeps({
      queryOne: vi.fn().mockResolvedValue(null), // no unsubscribe, no active campaign
      query: vi.fn().mockResolvedValue([row]),
    });
    const record = await startCampaign(deps, USER_ID, 65, DORMANT_LAST_PURCHASE, NOW);
    expect(record).not.toBeNull();
    expect(record?.userId).toBe(USER_ID);
    expect(record?.dormancyLevel).toBe('dormant');
    expect(record?.status).toBe('active');
    expect(record?.churnScore).toBe(65);
    expect(record?.currentStep).toBe(0);
  });

  it('starts a campaign for an at_risk user (70 days)', async () => {
    const row = makeDbRow({ dormancy_level: 'at_risk' });
    const deps = makeDeps({
      queryOne: vi.fn().mockResolvedValue(null),
      query: vi.fn().mockResolvedValue([row]),
    });
    const record = await startCampaign(deps, USER_ID, 40, AT_RISK_LAST_PURCHASE, NOW);
    expect(record?.dormancyLevel).toBe('at_risk');
  });

  it('starts a campaign for a churned user (200 days)', async () => {
    const row = makeDbRow({ dormancy_level: 'churned', churn_score: 90 });
    const deps = makeDeps({
      queryOne: vi.fn().mockResolvedValue(null),
      query: vi.fn().mockResolvedValue([row]),
    });
    const record = await startCampaign(deps, USER_ID, 90, CHURNED_LAST_PURCHASE, NOW);
    expect(record?.dormancyLevel).toBe('churned');
  });

  it('throws AlreadyInCampaignError if user already has active campaign', async () => {
    const deps = makeDeps({
      // First queryOne (unsubscribe check) → null, second (active check) → existing row
      queryOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: RECORD_ID }),
    });
    await expect(startCampaign(deps, USER_ID, 65, DORMANT_LAST_PURCHASE, NOW))
      .rejects.toThrow(AlreadyInCampaignError);
  });

  it('throws UserUnsubscribedError if user has unsubscribed', async () => {
    const deps = makeDeps({
      queryOne: vi.fn().mockResolvedValueOnce({ status: 'unsubscribed' }),
    });
    await expect(startCampaign(deps, USER_ID, 65, DORMANT_LAST_PURCHASE, NOW))
      .rejects.toThrow(UserUnsubscribedError);
  });

  it('is idempotent: ON CONFLICT returns existing record via fallback queryOne', async () => {
    const existingRow = makeDbRow();
    const deps = makeDeps({
      queryOne: vi.fn()
        .mockResolvedValueOnce(null)   // unsubscribe check
        .mockResolvedValueOnce(null)   // active campaign check
        .mockResolvedValueOnce(existingRow), // fallback after empty INSERT RETURNING
      query: vi.fn().mockResolvedValue([]), // ON CONFLICT DO NOTHING → empty result
    });
    const record = await startCampaign(deps, USER_ID, 65, DORMANT_LAST_PURCHASE, NOW);
    expect(record?.id).toBe(RECORD_ID);
  });

  it('defaults now to current time when not provided', async () => {
    const row = makeDbRow();
    const deps = makeDeps({
      queryOne: vi.fn().mockResolvedValue(null),
      query: vi.fn().mockResolvedValue([row]),
    });
    // Should not throw; dormancy is based on 100-day-old purchase
    const result = await startCampaign(deps, USER_ID, 65, daysAgo(100));
    // result may be null if current real-time < threshold, but in test the
    // function call itself must not throw
    expect(result === null || typeof result === 'object').toBe(true);
  });
});

// ─── sendNextStep ─────────────────────────────────────────────────────────────

describe('sendNextStep', () => {
  it('sends step 0 (email) and advances currentStep to 1', async () => {
    const emailSend = vi.fn().mockResolvedValue(undefined);
    const row = makeDbRow({ current_step: 0, last_step_sent_at: null });
    const deps = makeDeps({
      queryOne: vi.fn().mockResolvedValue(row),
      emailSend,
    });
    const result = await sendNextStep(deps, RECORD_ID, NOW);
    expect(emailSend).toHaveBeenCalledOnce();
    expect(emailSend).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID,
      templateId: CAMPAIGN_STEPS[0]!.templateId,
    }));
    expect(result.currentStep).toBe(1);
    expect(result.status).toBe('active');
    expect(result.lastStepSentAt).toEqual(NOW);
  });

  it('sends step 1 (push) and advances currentStep to 2', async () => {
    const pushSend = vi.fn().mockResolvedValue(undefined);
    const row = makeDbRow({ current_step: 1, last_step_sent_at: daysAgo(3).toISOString() });
    const deps = makeDeps({
      queryOne: vi.fn().mockResolvedValue(row),
      pushSend,
    });
    const result = await sendNextStep(deps, RECORD_ID, NOW);
    expect(pushSend).toHaveBeenCalledOnce();
    expect(pushSend).toHaveBeenCalledWith(expect.objectContaining({
      templateId: CAMPAIGN_STEPS[1]!.templateId,
    }));
    expect(result.currentStep).toBe(2);
    expect(result.status).toBe('active');
  });

  it('sends final step (step 2, email) and sets status to completed', async () => {
    const emailSend = vi.fn().mockResolvedValue(undefined);
    const row = makeDbRow({ current_step: 2, last_step_sent_at: daysAgo(4).toISOString() });
    const deps = makeDeps({
      queryOne: vi.fn().mockResolvedValue(row),
      emailSend,
    });
    const result = await sendNextStep(deps, RECORD_ID, NOW);
    expect(emailSend).toHaveBeenCalledOnce();
    expect(result.status).toBe('completed');
    expect(result.currentStep).toBe(3);
  });

  it('sets status completed without sending when currentStep is past all steps', async () => {
    const emailSend = vi.fn();
    const pushSend = vi.fn();
    const row = makeDbRow({ current_step: 3, status: 'active' }); // beyond CAMPAIGN_STEPS length
    const deps = makeDeps({
      queryOne: vi.fn().mockResolvedValue(row),
      emailSend,
      pushSend,
    });
    const result = await sendNextStep(deps, RECORD_ID, NOW);
    expect(emailSend).not.toHaveBeenCalled();
    expect(pushSend).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
  });

  it('throws RecordNotFoundError when record does not exist', async () => {
    const deps = makeDeps({
      queryOne: vi.fn().mockResolvedValue(null),
    });
    await expect(sendNextStep(deps, 'nonexistent-id', NOW))
      .rejects.toThrow(RecordNotFoundError);
  });

  it('throws UserUnsubscribedError for unsubscribed records', async () => {
    const row = makeDbRow({ status: 'unsubscribed' });
    const deps = makeDeps({
      queryOne: vi.fn().mockResolvedValue(row),
    });
    await expect(sendNextStep(deps, RECORD_ID, NOW))
      .rejects.toThrow(UserUnsubscribedError);
  });

  it('returns record unchanged for non-active, non-unsubscribed status (e.g. converted)', async () => {
    const row = makeDbRow({ status: 'converted' });
    const deps = makeDeps({
      queryOne: vi.fn().mockResolvedValue(row),
    });
    const result = await sendNextStep(deps, RECORD_ID, NOW);
    expect(result.status).toBe('converted');
  });

  it('emits a Kafka fire-and-forget event on step send', async () => {
    const kafkaProduce = vi.fn().mockResolvedValue(undefined);
    const row = makeDbRow({ current_step: 0 });
    const deps = makeDeps({
      queryOne: vi.fn().mockResolvedValue(row),
      kafkaProduce,
    });
    await sendNextStep(deps, RECORD_ID, NOW);
    // fire-and-forget is async; give microtask queue a cycle
    await Promise.resolve();
    expect(kafkaProduce).toHaveBeenCalledWith(
      're-engagement.step-sent',
      USER_ID,
      expect.objectContaining({ recordId: RECORD_ID, stepIndex: 0 }),
    );
  });

  it('persists lastStepSentAt and currentStep to DB', async () => {
    const execute = vi.fn().mockResolvedValue({ rowsAffected: 1 });
    const row = makeDbRow({ current_step: 0 });
    const deps = makeDeps({
      queryOne: vi.fn().mockResolvedValue(row),
      execute,
    });
    await sendNextStep(deps, RECORD_ID, NOW);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE marketing.re_engagement_campaigns'),
      expect.arrayContaining([NOW.toISOString(), 1, 'active', RECORD_ID]),
    );
  });
});

// ─── markConverted ────────────────────────────────────────────────────────────

describe('markConverted', () => {
  it('updates active campaigns to converted', async () => {
    const execute = vi.fn().mockResolvedValue({ rowsAffected: 1 });
    const deps = makeDeps({ execute });
    await markConverted(deps, USER_ID);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'converted'"),
      expect.arrayContaining([USER_ID]),
    );
  });

  it('emits a Kafka converted event (fire-and-forget)', async () => {
    const kafkaProduce = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ kafkaProduce });
    await markConverted(deps, USER_ID);
    await Promise.resolve();
    expect(kafkaProduce).toHaveBeenCalledWith(
      're-engagement.converted',
      USER_ID,
      expect.objectContaining({ userId: USER_ID }),
    );
  });

  it('does not throw when no active campaigns exist (0 rows affected)', async () => {
    const deps = makeDeps({
      execute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
    });
    await expect(markConverted(deps, USER_ID)).resolves.toBeUndefined();
  });
});

// ─── unsubscribe ──────────────────────────────────────────────────────────────

describe('unsubscribe', () => {
  it('updates active campaigns to unsubscribed', async () => {
    const execute = vi.fn().mockResolvedValue({ rowsAffected: 1 });
    const deps = makeDeps({ execute });
    await unsubscribe(deps, USER_ID);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'unsubscribed'"),
      expect.arrayContaining([USER_ID]),
    );
  });

  it('inserts an unsubscribe preference record', async () => {
    const execute = vi.fn().mockResolvedValue({ rowsAffected: 1 });
    const deps = makeDeps({ execute });
    await unsubscribe(deps, USER_ID);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('re_engagement_unsubscribes'),
      expect.arrayContaining([USER_ID]),
    );
  });

  it('emits a Kafka unsubscribed event', async () => {
    const kafkaProduce = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ kafkaProduce });
    await unsubscribe(deps, USER_ID);
    await Promise.resolve();
    expect(kafkaProduce).toHaveBeenCalledWith(
      're-engagement.unsubscribed',
      USER_ID,
      expect.objectContaining({ userId: USER_ID }),
    );
  });

  it('GDPR: unsubscribes even when campaign is currently active', async () => {
    // Should NOT throw or check campaign status — always succeeds
    const execute = vi.fn().mockResolvedValue({ rowsAffected: 1 });
    const deps = makeDeps({ execute });
    await expect(unsubscribe(deps, USER_ID)).resolves.toBeUndefined();
    // Verify it does NOT filter by status in the unsubscribe UPDATE
    const firstCallArgs = execute.mock.calls[0];
    expect(firstCallArgs).toBeDefined();
    // The SQL should NOT restrict to only 'active' status — it covers all non-terminal
    expect(firstCallArgs![0]).toContain("status NOT IN ('converted', 'unsubscribed')");
  });

  it('is idempotent (ON CONFLICT DO NOTHING on unsubscribes table)', async () => {
    const execute = vi.fn().mockResolvedValue({ rowsAffected: 0 });
    const deps = makeDeps({ execute });
    await expect(unsubscribe(deps, USER_ID)).resolves.toBeUndefined();
    const unsubInsertCall = execute.mock.calls.find(
      (args) => typeof args[0] === 'string' && (args[0] as string).includes('ON CONFLICT'),
    );
    expect(unsubInsertCall).toBeDefined();
  });
});

// ─── runCampaignBatch ─────────────────────────────────────────────────────────

describe('runCampaignBatch', () => {
  it('returns { processed: 0, failed: 0 } when no active records', async () => {
    const deps = makeDeps({
      query: vi.fn().mockResolvedValue([]),
    });
    const result = await runCampaignBatch(deps, NOW);
    expect(result).toEqual({ processed: 0, failed: 0 });
  });

  it('sends step for a record where step 0 is due (day offset = 0)', async () => {
    const row = makeDbRow({
      current_step: 0,
      campaign_started_at: daysAgo(0).toISOString(), // started today
      last_step_sent_at: null,
    });
    const emailSend = vi.fn().mockResolvedValue(undefined);
    // query for batch returns the row; queryOne for sendNextStep returns same row
    const deps = makeDeps({
      query: vi.fn().mockResolvedValue([row]),
      queryOne: vi.fn().mockResolvedValue(row),
      emailSend,
    });
    const result = await runCampaignBatch(deps, NOW);
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(emailSend).toHaveBeenCalledOnce();
  });

  it('skips a record where step 1 is not yet due', async () => {
    // Campaign started today; step 1 requires D+3 days but only D+1 has passed
    const oneDayAgo = daysAgo(1);
    const row = makeDbRow({
      current_step: 1,
      campaign_started_at: oneDayAgo.toISOString(),
      last_step_sent_at: oneDayAgo.toISOString(),
    });
    const deps = makeDeps({
      query: vi.fn().mockResolvedValue([row]),
    });
    const result = await runCampaignBatch(deps, NOW);
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('processes a record where step 1 (D+3) is due', async () => {
    const threeDaysAgo = daysAgo(3);
    const row = makeDbRow({
      current_step: 1,
      campaign_started_at: threeDaysAgo.toISOString(),
      last_step_sent_at: threeDaysAgo.toISOString(),
    });
    const pushSend = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      query: vi.fn().mockResolvedValue([row]),
      queryOne: vi.fn().mockResolvedValue(row),
      pushSend,
    });
    const result = await runCampaignBatch(deps, NOW);
    expect(result.processed).toBe(1);
    expect(pushSend).toHaveBeenCalledOnce();
  });

  it('counts a failed sendNextStep as failed, not processed', async () => {
    const row = makeDbRow({ current_step: 0, campaign_started_at: NOW.toISOString() });
    const deps = makeDeps({
      query: vi.fn().mockResolvedValue([row]),
      queryOne: vi.fn().mockRejectedValue(new Error('DB down')),
    });
    const result = await runCampaignBatch(deps, NOW);
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
  });

  it('continues processing remaining records after one failure', async () => {
    const rows = [
      makeDbRow({ id: 'id-1', user_id: 'user-1', current_step: 0, campaign_started_at: NOW.toISOString() }),
      makeDbRow({ id: 'id-2', user_id: 'user-2', current_step: 0, campaign_started_at: NOW.toISOString() }),
    ];
    const emailSend = vi.fn().mockResolvedValue(undefined);
    // First call fails, second succeeds
    const queryOne = vi.fn()
      .mockRejectedValueOnce(new Error('transient error'))
      .mockResolvedValueOnce(rows[1]);
    const deps = makeDeps({ query: vi.fn().mockResolvedValue(rows), queryOne, emailSend });
    const result = await runCampaignBatch(deps, NOW);
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(1);
  });

  it('skips records with current_step beyond CAMPAIGN_STEPS length', async () => {
    const row = makeDbRow({ current_step: 99, campaign_started_at: NOW.toISOString() });
    const deps = makeDeps({
      query: vi.fn().mockResolvedValue([row]),
    });
    const result = await runCampaignBatch(deps, NOW);
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
  });
});
