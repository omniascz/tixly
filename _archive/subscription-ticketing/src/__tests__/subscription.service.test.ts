import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSubscription,
  getSubscription,
  redeemEvent,
  renewSubscription,
  cancelSubscription,
  expireSubscriptions,
  listRedemptions,
  listPlans,
} from '../services/subscription.service';
import {
  SubscriptionNotFoundError,
  SubscriptionInactiveError,
  NoRedemptionsRemainingError,
  PlanNotFoundError,
  DuplicateRedemptionError,
} from '../lib/types';

// ─── Mock DB ─────────────────────────────────────────────────

const mockDb = {
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn((cb: (db: typeof mockDb) => Promise<unknown>) => cb(mockDb)),
};

beforeEach(() => vi.clearAllMocks());

// ─── Fixtures ────────────────────────────────────────────────

const planRow = {
  id: 'plan-1',
  name: 'Basic',
  description: '2 akce měsíčně',
  billing_period: 'monthly',
  price_halire: 29900,
  events_per_period: 2,
  organizer_id: null,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
};

const subRow = {
  id: 'sub-1',
  user_id: 'user-1',
  plan_id: 'plan-1',
  status: 'active',
  current_period_start: '2026-04-01T00:00:00Z',
  current_period_end: '2026-05-01T00:00:00Z',
  remaining_redemptions: 2,
  gopay_recurring_token: 'token-abc',
  gopay_payment_id: 'pay-1',
  cancelled_at: null,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
};

const redemptionRow = {
  id: 'redemption-1',
  subscription_id: 'sub-1',
  user_id: 'user-1',
  event_id: 'event-1',
  order_id: 'order-1',
  status: 'used',
  redeemed_at: '2026-04-10T12:00:00Z',
};

// ─── Tests ───────────────────────────────────────────────────

describe('createSubscription', () => {
  it('creates subscription with period and redemptions seeded from plan', async () => {
    mockDb.queryOne.mockResolvedValueOnce(planRow); // getPlan
    mockDb.query.mockResolvedValueOnce([{
      ...subRow,
      remaining_redemptions: 2,
    }]);

    const sub = await createSubscription(
      { userId: 'user-1', planId: 'plan-1', gopayPaymentId: 'pay-1', gopayRecurringToken: 'token-abc' },
      mockDb,
    );

    expect(sub.userId).toBe('user-1');
    expect(sub.planId).toBe('plan-1');
    expect(sub.status).toBe('active');
    expect(sub.remainingRedemptions).toBe(2);
  });

  it('throws PlanNotFoundError when plan does not exist', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);

    await expect(
      createSubscription({ userId: 'user-1', planId: 'missing' }, mockDb),
    ).rejects.toThrow(PlanNotFoundError);
  });
});

describe('getSubscription', () => {
  it('returns subscription by id', async () => {
    mockDb.queryOne.mockResolvedValueOnce(subRow);

    const sub = await getSubscription('sub-1', mockDb);
    expect(sub.id).toBe('sub-1');
    expect(sub.status).toBe('active');
  });

  it('throws SubscriptionNotFoundError for unknown id', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);

    await expect(getSubscription('missing', mockDb)).rejects.toThrow(SubscriptionNotFoundError);
  });
});

describe('redeemEvent', () => {
  it('decrements remaining_redemptions and inserts redemption record', async () => {
    mockDb.queryOne
      .mockResolvedValueOnce(subRow)          // getSubscription
      .mockResolvedValueOnce(null)            // no duplicate
      .mockResolvedValueOnce({ remaining_redemptions: 1 }); // atomic decrement
    mockDb.query.mockResolvedValueOnce([redemptionRow]);

    const redemption = await redeemEvent(
      { subscriptionId: 'sub-1', userId: 'user-1', eventId: 'event-1', orderId: 'order-1' },
      mockDb,
    );

    expect(redemption.eventId).toBe('event-1');
    expect(redemption.status).toBe('used');
  });

  it('throws SubscriptionInactiveError when subscription is not active', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ ...subRow, status: 'cancelled' });

    await expect(
      redeemEvent({ subscriptionId: 'sub-1', userId: 'user-1', eventId: 'event-1', orderId: 'order-1' }, mockDb),
    ).rejects.toThrow(SubscriptionInactiveError);
  });

  it('throws DuplicateRedemptionError when event already redeemed in period', async () => {
    mockDb.queryOne
      .mockResolvedValueOnce(subRow)
      .mockResolvedValueOnce({ id: 'existing-redemption' }); // duplicate found

    await expect(
      redeemEvent({ subscriptionId: 'sub-1', userId: 'user-1', eventId: 'event-1', orderId: 'order-2' }, mockDb),
    ).rejects.toThrow(DuplicateRedemptionError);
  });

  it('throws NoRedemptionsRemainingError when quota exhausted', async () => {
    mockDb.queryOne
      .mockResolvedValueOnce({ ...subRow, remaining_redemptions: 0 })
      .mockResolvedValueOnce(null)    // no duplicate
      .mockResolvedValueOnce(null);   // atomic decrement returns null → no slots

    await expect(
      redeemEvent({ subscriptionId: 'sub-1', userId: 'user-1', eventId: 'event-99', orderId: 'order-99' }, mockDb),
    ).rejects.toThrow(NoRedemptionsRemainingError);
  });
});

describe('renewSubscription', () => {
  it('advances period and resets redemptions to plan quota', async () => {
    mockDb.queryOne
      .mockResolvedValueOnce(subRow)   // getSubscription
      .mockResolvedValueOnce(planRow); // getPlan
    mockDb.query.mockResolvedValueOnce([{
      ...subRow,
      current_period_start: '2026-05-01T00:00:00Z',
      current_period_end: '2026-06-01T00:00:00Z',
      remaining_redemptions: 2,
    }]);

    const renewed = await renewSubscription(
      { subscriptionId: 'sub-1', gopayPaymentId: 'pay-2' },
      mockDb,
    );

    expect(renewed.remainingRedemptions).toBe(2);
    expect(renewed.currentPeriodStart.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });
});

describe('cancelSubscription', () => {
  it('sets status to cancelled', async () => {
    mockDb.queryOne.mockResolvedValueOnce(subRow);
    mockDb.query.mockResolvedValueOnce([{ ...subRow, status: 'cancelled', cancelled_at: '2026-04-21T00:00:00Z' }]);

    const cancelled = await cancelSubscription('sub-1', 'user-1', mockDb);

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelledAt).toBeDefined();
  });

  it('returns subscription unchanged when already cancelled', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ ...subRow, status: 'cancelled', cancelled_at: '2026-04-01T00:00:00Z' });

    const sub = await cancelSubscription('sub-1', 'user-1', mockDb);
    expect(sub.status).toBe('cancelled');
  });

  it('throws SubscriptionNotFoundError when userId does not match', async () => {
    mockDb.queryOne.mockResolvedValueOnce(subRow);

    await expect(cancelSubscription('sub-1', 'other-user', mockDb)).rejects.toThrow(SubscriptionNotFoundError);
  });
});

describe('expireSubscriptions', () => {
  it('returns count of expired rows', async () => {
    mockDb.execute.mockResolvedValueOnce({ rowCount: 3 });

    const count = await expireSubscriptions(mockDb);
    expect(count).toBe(3);
  });
});

describe('listRedemptions', () => {
  it('returns redemptions for subscription', async () => {
    mockDb.query.mockResolvedValueOnce([redemptionRow]);

    const redemptions = await listRedemptions('sub-1', mockDb);
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0].eventId).toBe('event-1');
  });
});

describe('listPlans', () => {
  it('returns all active plans', async () => {
    mockDb.query.mockResolvedValueOnce([planRow]);

    const plans = await listPlans(mockDb);
    expect(plans).toHaveLength(1);
    expect(plans[0].eventsPerPeriod).toBe(2);
  });

  it('filters by organizer when provided', async () => {
    mockDb.query.mockResolvedValueOnce([planRow]);

    const plans = await listPlans(mockDb, 'org-1');
    expect(plans).toHaveLength(1);
    // Assert correct SQL param was used
    const callArgs = mockDb.query.mock.calls[0];
    expect(callArgs[1]).toContain('org-1');
  });
});
