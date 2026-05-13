import {
  applyReferralReward,
  SelfReferralRejectedError,
  DuplicateDeviceRejectedError,
  DEFAULT_DUAL_REWARD_CONFIG,
} from './dual-reward.service';

function makeFakeDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let dupFingerprint: string | null = null;
  let existingOrder: string | null = null;
  let idSeq = 0;
  const db = {
    query: async () => [],
    execute: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rowCount: 1 };
    },
    queryOne: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('device_fingerprint = $1') && dupFingerprint && params[0] === dupFingerprint) {
        return { id: 'dup' };
      }
      if (sql.includes('FROM referral.dual_rewards') && sql.includes('WHERE order_id = $1')) {
        if (existingOrder && params[0] === existingOrder) {
          return {
            referrer_credit_id: 'r-existing',
            new_customer_credit_id: 'n-existing',
          };
        }
        return null;
      }
      if (sql.includes('INSERT INTO referral.credit_transactions')) {
        idSeq += 1;
        return { id: `credit-${idSeq}` };
      }
      return null;
    },
  };
  return {
    db,
    calls,
    setDupFingerprint: (fp: string) => { dupFingerprint = fp; },
    setExistingOrder: (o: string) => { existingOrder = o; },
  };
}

function makeFakeKafka() {
  const events: Array<{ topic: string; key: string; value: unknown }> = [];
  return {
    kafka: {
      publish: async (topic: string, key: string, value: unknown) => {
        events.push({ topic, key, value });
      },
    },
    events,
  };
}

describe('applyReferralReward', () => {
  test('rejects self-referral', async () => {
    const { db } = makeFakeDb();
    const { kafka } = makeFakeKafka();
    await expect(
      applyReferralReward('u1', 'u1', 'order-1', { db: db as never, kafka: kafka as never }),
    ).rejects.toBeInstanceOf(SelfReferralRejectedError);
  });

  test('inserts dual credits with default 100 Kč each and emits kafka', async () => {
    const { db } = makeFakeDb();
    const { kafka, events } = makeFakeKafka();
    const res = await applyReferralReward('ref', 'new', 'order-2', {
      db: db as never,
      kafka: kafka as never,
    });
    expect(res.referrerRewardHalire).toBe(DEFAULT_DUAL_REWARD_CONFIG.referrerRewardHalire);
    expect(res.newCustomerRewardHalire).toBe(DEFAULT_DUAL_REWARD_CONFIG.newCustomerRewardHalire);
    expect(res.referrerCreditId).toBeTruthy();
    expect(res.newCustomerCreditId).toBeTruthy();
    expect(events[0].topic).toBe('referral.reward_applied');
  });

  test('is idempotent per orderId', async () => {
    const helper = makeFakeDb();
    helper.setExistingOrder('order-3');
    const { kafka, events } = makeFakeKafka();
    const res = await applyReferralReward('ref', 'new', 'order-3', {
      db: helper.db as never,
      kafka: kafka as never,
    });
    expect(res.referrerCreditId).toBe('r-existing');
    expect(events.length).toBe(0); // no new emit
  });

  test('rejects duplicate device fingerprint in 90d window', async () => {
    const helper = makeFakeDb();
    helper.setDupFingerprint('fp-xyz');
    const { kafka } = makeFakeKafka();
    await expect(
      applyReferralReward('ref', 'new', 'order-4', {
        db: helper.db as never,
        kafka: kafka as never,
        deviceFingerprint: 'fp-xyz',
      }),
    ).rejects.toBeInstanceOf(DuplicateDeviceRejectedError);
  });
});
