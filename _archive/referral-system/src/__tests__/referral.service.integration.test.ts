import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLink } from '../services/referral-link.service.js';
import { trackClick } from '../services/click-tracking.service.js';
import { recordConversion } from '../services/conversion.service.js';
import { addCredit, spendCredit, getBalance } from '../services/credit.service.js';
import {
  CreditTransactionType,
  type DbAdapter,
  type KafkaProducerAdapter,
} from '../types/referral.types.js';

// ============================================================
// Integration — end-to-end mock flow
// createLink → trackClick → recordConversion → applyCredit
// ============================================================

/**
 * Small in-memory DbAdapter that returns canned rows in sequence.
 * Each test seeds `queueOne` / `queue` with the rows it expects, in order.
 */
function makeMockDb() {
  const queryOne = vi.fn();
  const query = vi.fn();
  const execute = vi.fn().mockResolvedValue(undefined);
  const transaction = vi.fn(async (fn: (tx: DbAdapter) => Promise<unknown>) =>
    fn({ queryOne, query, execute, transaction } as unknown as DbAdapter),
  );
  const db: DbAdapter = {
    queryOne,
    query,
    execute,
    transaction,
  } as unknown as DbAdapter;
  return { db, queryOne, query, execute };
}

function makeMockKafka(): KafkaProducerAdapter & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

describe('referral-system integration — full happy path', () => {
  let mock: ReturnType<typeof makeMockDb>;
  let kafka: ReturnType<typeof makeMockKafka>;

  beforeEach(() => {
    mock = makeMockDb();
    kafka = makeMockKafka();
  });

  it('createLink → trackClick → recordConversion → applyCredit returns expected shapes', async () => {
    const referrerId = '11111111-1111-1111-1111-111111111111';
    const referredUserId = '22222222-2222-2222-2222-222222222222';
    const linkId = '33333333-3333-3333-3333-333333333333';
    const orderId = '44444444-4444-4444-4444-444444444444';

    const linkRow = {
      id: linkId,
      user_id: referrerId,
      code: 'AbCd1234',
      campaign_id: null,
      created_at: '2026-04-08T10:00:00Z',
      is_active: true,
      total_clicks: 0,
      total_conversions: 0,
      total_earned_halire: '0',
    };

    // --- createLink ------------------------------------------------------
    // 1) collision check → null  2) INSERT RETURNING linkRow
    mock.queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(linkRow);

    const link = await createLink(referrerId, {}, mock.db);
    expect(link.id).toBe(linkId);
    expect(link.userId).toBe(referrerId);
    expect(link.code).toHaveLength(8);
    expect(link.isActive).toBe(true);
    expect(link.totalEarnedHalire).toBe(0);

    // --- trackClick ------------------------------------------------------
    // trackClick calls getLinkByCode (SELECT * WHERE code = $1) → linkRow
    // then INSERT INTO referral.clicks RETURNING → clickRow
    // then UPDATE referral.links total_clicks (execute, no return)
    const clickRow = {
      id: '1001',
      link_id: linkId,
      referrer_code: 'AbCd1234',
      visitor_id: 'visitor-xyz',
      session_id: 'sess-xyz',
      ip_hash: 'hash-ip',
      user_agent_hash: 'hash-ua',
      occurred_at: '2026-04-08T10:05:00Z',
      converted: false,
      converted_at: null,
    };
    mock.queryOne
      .mockResolvedValueOnce(linkRow) // getLinkByCode
      .mockResolvedValueOnce(clickRow); // INSERT click

    const click = await trackClick(
      {
        code: 'AbCd1234',
        visitorId: 'visitor-xyz',
        sessionId: 'sess-xyz',
        ip: '1.2.3.4',
        userAgent: 'Mozilla/5.0',
      },
      mock.db,
    );
    expect(click.id).toBe(1001n);
    expect(click.linkId).toBe(linkId);
    expect(click.visitorId).toBe('visitor-xyz');

    // --- recordConversion ------------------------------------------------
    // 1) getLinkByCode            → linkRow
    // 2) getClicksForVisitor      → [clickRow]  (via query, not queryOne)
    // 3) INSERT conversion RETURN → conversionRow
    // 4) addCredit UPSERT wallet  (execute)
    // 5) addCredit INSERT tx      (execute)
    // 6) UPDATE link aggregate    (execute)
    const conversionRow = {
      id: '55555555-5555-5555-5555-555555555555',
      link_id: linkId,
      click_id: '1001',
      order_id: orderId,
      referred_user_id: referredUserId,
      order_amount_halire: '100000',
      commission_rate: '0.05',
      earned_halire: '5000',
      status: 'pending',
      created_at: '2026-04-08T10:10:00Z',
      confirmed_at: null,
      paid_at: null,
    };
    mock.queryOne
      .mockResolvedValueOnce(linkRow) // getLinkByCode
      .mockResolvedValueOnce(conversionRow); // INSERT conversion
    mock.query.mockResolvedValueOnce([clickRow]); // getClicksForVisitor

    const conversion = await recordConversion(
      {
        orderId,
        referredUserId,
        referrerCode: 'AbCd1234',
        orderAmountHalire: 100_000,
        visitorId: 'visitor-xyz',
      },
      mock.db,
      kafka,
    );
    expect(conversion.id).toBe('55555555-5555-5555-5555-555555555555');
    expect(conversion.orderId).toBe(orderId);
    expect(conversion.earnedHalire).toBe(5000);
    expect(conversion.status).toBe('pending');
    expect(kafka.publish).toHaveBeenCalledWith(
      'referral.converted',
      conversion.id,
      expect.objectContaining({ referrerId, orderId, earnedHalire: 5000 }),
    );

    // --- applyCredit (spendCredit on referred user after topup) ----------
    // addCredit (UPSERT wallet + INSERT tx) — both execute calls
    await addCredit(
      referredUserId,
      100,
      CreditTransactionType.ReferralEarned,
      'ref-1',
      'Welcome credit',
      mock.db,
    );

    // getBalance returns the wallet row
    mock.queryOne.mockResolvedValueOnce({
      user_id: referredUserId,
      balance_halire: '10000',
      lifetime_earned_halire: '10000',
      lifetime_spent_halire: '0',
      updated_at: '2026-04-08T10:12:00Z',
    });

    const wallet = await getBalance(referredUserId, mock.db);
    expect(wallet.balanceHalire).toBe(10000);
    expect(wallet.lifetimeEarnedHalire).toBe(10000);

    // spendCredit calls getBalance again, then UPDATE wallet + INSERT tx
    mock.queryOne.mockResolvedValueOnce({
      user_id: referredUserId,
      balance_halire: '10000',
      lifetime_earned_halire: '10000',
      lifetime_spent_halire: '0',
      updated_at: '2026-04-08T10:13:00Z',
    });

    await expect(
      spendCredit(referredUserId, 40, orderId, mock.db),
    ).resolves.toBeUndefined();

    // Sanity — execute was called multiple times (updates/inserts)
    expect(mock.execute).toHaveBeenCalled();
  });
});
