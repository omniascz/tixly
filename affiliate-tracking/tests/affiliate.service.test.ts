import { describe, it, expect, vi } from 'vitest';
import {
  createAffiliate, createLink, trackClick, recordConversion, requestPayout, getLinkStats,
} from '../src/services/affiliate.service';
import {
  AffiliateLinkNotFoundError, AffiliateNotActiveError,
  PayoutThresholdNotReachedError, DuplicateConversionError,
} from '../src/types/affiliate.types';

function makeDb() {
  return {
    query: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const tx = makeDb();
      tx.query = vi.fn();
      tx.execute = vi.fn();
      return fn(tx);
    }),
  };
}
function makeDeps() {
  return { db: makeDb(), kafka: { send: vi.fn().mockResolvedValue(undefined) } };
}

// ---------------------------------------------------------------------------
describe('createAffiliate()', () => {
  it('vytvoří affiliate s commissionRateBps', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([{ id: 'aff_1', created_at: new Date() }]);

    const result = await createAffiliate(deps, 'promoter_1', { userId: 'user_1', commissionRateBps: 500 });
    expect(result.commissionRateBps).toBe(500);
    expect(result.walletBalance).toBe(0);
    expect(result.payoutThreshold).toBe(50000);
  });

  it('vyhodí RangeError pro commissionRateBps > 5000', async () => {
    const deps = makeDeps();
    await expect(createAffiliate(deps, 'p_1', { userId: 'u_1', commissionRateBps: 5001 }))
      .rejects.toThrow(RangeError);
  });

  it('vyhodí RangeError pro záporné commissionRateBps', async () => {
    const deps = makeDeps();
    await expect(createAffiliate(deps, 'p_1', { userId: 'u_1', commissionRateBps: -1 }))
      .rejects.toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
describe('createLink()', () => {
  it('vytvoří link s unikátním kódem', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([{ status: 'active' }])   // affiliate check
      .mockResolvedValueOnce([])                        // code collision check → žádná kolize
      .mockResolvedValueOnce([{ id: 'link_1', created_at: new Date() }]); // INSERT

    const result = await createLink(deps, 'aff_1', 'user_1', { eventId: 'evt_1' });
    expect(result.code).toHaveLength(8);
    expect(result.affiliateId).toBe('aff_1');
  });

  it('vyhodí AffiliateNotActiveError pro suspendovaného affiliata', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([{ status: 'suspended' }]);

    await expect(createLink(deps, 'aff_1', 'user_1', {}))
      .rejects.toThrow(AffiliateNotActiveError);
  });
});

// ---------------------------------------------------------------------------
describe('trackClick()', () => {
  it('zaznamená klik a vrátí redirectUrl', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([{
      id: 'link_1', event_id: 'evt_1', affiliate_status: 'active',
    }]);
    deps.db.execute = vi.fn().mockResolvedValue(undefined);
    process.env.NEXT_PUBLIC_APP_URL = 'https://tixly.cz';

    const result = await trackClick(deps, 'AbCd1234', 'sess_1', null);
    expect(result.redirectUrl).toContain('evt_1');
    expect(result.cookieTtlDays).toBe(30);
  });

  it('vyhodí AffiliateLinkNotFoundError pro neplatný kód', async () => {
    const deps = makeDeps();
    await expect(trackClick(deps, 'bad!', 'sess_1', null))
      .rejects.toThrow(AffiliateLinkNotFoundError);
  });

  it('redirectuje na homepage pokud link nemá eventId', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([{
      id: 'link_1', event_id: null, affiliate_status: 'active',
    }]);
    deps.db.execute = vi.fn().mockResolvedValue(undefined);
    process.env.NEXT_PUBLIC_APP_URL = 'https://tixly.cz';

    const result = await trackClick(deps, 'AbCd1234', 'sess_1', null);
    expect(result.redirectUrl).toBe('https://tixly.cz/cs/akce');
  });
});

// ---------------------------------------------------------------------------
describe('recordConversion()', () => {
  it('přičte komisi do wallet a vrátí konverzi', async () => {
    const deps = makeDeps();

    deps.db.transaction = vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const tx = makeDb();
      tx.query = vi.fn()
        .mockResolvedValueOnce([{ id: 'link_1', affiliate_id: 'aff_1', commission_rate_bps: 500 }])
        .mockResolvedValueOnce([{ id: 'conv_1', created_at: new Date() }]);
      tx.execute = vi.fn().mockResolvedValue(undefined);
      return fn(tx);
    });

    const result = await recordConversion(deps, {
      orderId: 'ord_1', orderAmount: 100_000, affiliateCode: 'AbCd1234',
    });

    expect(result.commission).toBe(5000);   // 5 % z 100 000 haléřů
    expect(result.orderId).toBe('ord_1');
    expect(deps.kafka.send).toHaveBeenCalledWith('tixly.affiliate.conversion', expect.any(Object));
  });

  it('vyhodí DuplicateConversionError pro stejnou objednávku', async () => {
    const deps = makeDeps();
    deps.db.transaction = vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const tx = makeDb();
      tx.query = vi.fn()
        .mockResolvedValueOnce([{ id: 'link_1', affiliate_id: 'aff_1', commission_rate_bps: 500 }])
        .mockResolvedValueOnce([]);  // ON CONFLICT DO NOTHING → prázdné
      tx.execute = vi.fn().mockResolvedValue(undefined);
      return fn(tx);
    });

    await expect(recordConversion(deps, { orderId: 'ord_dup', orderAmount: 100_000, affiliateCode: 'AbCd1234' }))
      .rejects.toThrow(DuplicateConversionError);
  });
});

// ---------------------------------------------------------------------------
describe('requestPayout()', () => {
  it('vytvoří výplatu a vynuluje wallet', async () => {
    const deps = makeDeps();
    deps.db.transaction = vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const tx = makeDb();
      tx.query = vi.fn()
        .mockResolvedValueOnce([{ wallet_balance: 75000, payout_threshold: 50000, status: 'active' }])
        .mockResolvedValueOnce([{ id: 'payout_1', created_at: new Date() }]);
      tx.execute = vi.fn().mockResolvedValue(undefined);
      return fn(tx);
    });

    const result = await requestPayout(deps, 'aff_1', 'user_1');
    expect(result.amount).toBe(75000);
    expect(result.status).toBe('pending');
  });

  it('vyhodí PayoutThresholdNotReachedError pod prahem', async () => {
    const deps = makeDeps();
    deps.db.transaction = vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const tx = makeDb();
      tx.query = vi.fn().mockResolvedValueOnce([{ wallet_balance: 10000, payout_threshold: 50000, status: 'active' }]);
      return fn(tx);
    });

    const err = await requestPayout(deps, 'aff_1', 'user_1').catch((e) => e);
    expect(err).toBeInstanceOf(PayoutThresholdNotReachedError);
    expect(err.currentBalance).toBe(10000);
    expect(err.threshold).toBe(50000);
  });
});

// ---------------------------------------------------------------------------
describe('getLinkStats()', () => {
  it('vrátí statistiky se správnou conversionRate', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([{
      code: 'AbCd1234', click_count: 200, conversion_count: 10,
      total_order_amount: 500_000, total_commission: 25_000,
    }]);

    const stats = await getLinkStats(deps, 'AbCd1234', 'user_1');
    expect(stats.conversionRate).toBe(5);   // 10/200 × 100 = 5 %
    expect(stats.totalCommission).toBe(25_000);
  });

  it('conversionRate = 0 pokud žádné kliky', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([{
      code: 'AbCd1234', click_count: 0, conversion_count: 0,
      total_order_amount: 0, total_commission: 0,
    }]);

    const stats = await getLinkStats(deps, 'AbCd1234', 'user_1');
    expect(stats.conversionRate).toBe(0);
  });
});
