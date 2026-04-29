import { describe, it, expect, vi } from 'vitest';
import { createAffiliatePayoutBatch } from '../src/lib/payout-batch.js';

interface FakeRow { id: string; commission: number }

function makeDb(conversions: FakeRow[]) {
  const execute = vi.fn().mockResolvedValue(undefined);
  const query = vi.fn((sql: string) => {
    if (sql.includes('FROM affiliate.conversions')) return Promise.resolve(conversions);
    if (sql.includes('INSERT INTO affiliate.payouts')) {
      return Promise.resolve([{ id: 'payout-1', created_at: new Date('2026-04-08T12:00:00Z') }]);
    }
    return Promise.resolve([]);
  });
  return {
    db: {
      transaction: async <T>(fn: (tx: { query: typeof query; execute: typeof execute }) => Promise<T>) => fn({ query, execute }),
    },
    execute,
    query,
  };
}

describe('createAffiliatePayoutBatch()', () => {
  const from = new Date('2026-04-01T00:00:00Z');
  const to = new Date('2026-04-30T23:59:59Z');

  it('sčítá komise a vytvoří payout', async () => {
    const fake = makeDb([
      { id: 'c1', commission: 1000 },
      { id: 'c2', commission: 2500 },
      { id: 'c3', commission: 500 },
    ]);
    const result = await createAffiliatePayoutBatch('aff-1', from, to, { db: fake.db });
    expect(result).not.toBeNull();
    expect(result!.totalCommission).toBe(4000);
    expect(result!.payout.amount).toBe(4000);
    expect(result!.conversionIds).toEqual(['c1', 'c2', 'c3']);
  });

  it('vrací null pokud není co vyplácet', async () => {
    const fake = makeDb([]);
    const result = await createAffiliatePayoutBatch('aff-1', from, to, { db: fake.db });
    expect(result).toBeNull();
  });

  it('označí všechny konverze payout_id', async () => {
    const fake = makeDb([{ id: 'c1', commission: 1000 }]);
    await createAffiliatePayoutBatch('aff-1', from, to, { db: fake.db });
    const updateCall = fake.execute.mock.calls.find(([sql]) =>
      (sql as string).includes('UPDATE affiliate.conversions'),
    );
    expect(updateCall).toBeDefined();
  });
});
