import { describe, it, expect, vi } from 'vitest';
import {
  createCampaign,
  createShareLink,
  trackClick,
  recordConversion,
  getFanShareLink,
  getShareLinkConversions,
  getCampaign,
  getEventCampaigns,
} from '../services/fan-share.service.js';
import type { DbAdapter } from '../services/fan-share.service.js';

const EVENT_ID = 'event-001';
const PROMOTER_ID = 'promoter-001';
const FAN_USER_ID = 'user-001';
const CAMPAIGN_ID = 'campaign-001';
const SHARE_LINK_ID = 'link-001';
const SHARE_CODE = 'AbCd1234';
const ORDER_ID = 'order-001';

function makeCampaignRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_ID,
    event_id: EVENT_ID,
    promoter_id: PROMOTER_ID,
    is_active: true,
    reward_type: 'cashback',
    reward_value_hellers: 50000,  // 500 CZK cashback
    reward_discount_pct: null,
    reward_code_prefix: null,
    max_referrals: 10,
    expires_at: null,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeShareLinkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SHARE_LINK_ID,
    campaign_id: CAMPAIGN_ID,
    event_id: EVENT_ID,
    fan_user_id: FAN_USER_ID,
    share_code: SHARE_CODE,
    referral_count: 0,
    conversion_count: 0,
    total_earned_hellers: 0,
    is_active: true,
    created_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeConversionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-001',
    share_link_id: SHARE_LINK_ID,
    order_id: ORDER_ID,
    referred_user_id: 'user-002',
    reward_issued: true,
    reward_type: 'cashback',
    reward_value_hellers: 50000,
    reward_code: null,
    created_at: '2026-04-14T10:30:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn(async () => {
        const result = queryResults[callIdx] ?? [];
        callIdx++;
        return result;
      }),
      execute: executeMock,
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('createCampaign', () => {
  it('vytvoří fan share kampaň pro event', async () => {
    const db = makeDb([[makeCampaignRow()]]);

    const result = await createCampaign(
      EVENT_ID,
      PROMOTER_ID,
      {
        rewardType: 'cashback',
        rewardValueHellers: 50000,
        maxReferrals: 10,
      },
      db,
    );

    expect(result.eventId).toBe(EVENT_ID);
    expect(result.rewardType).toBe('cashback');
    expect(result.rewardValueHellers).toBe(50000);
  });

  it('vyhodí VALIDATION_ERROR bez rewardType', async () => {
    const db = makeDb([]);

    await expect(
      createCampaign(EVENT_ID, PROMOTER_ID, { rewardType: '' as any }, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('createShareLink', () => {
  it('vytvoří sdílecí odkaz pro fana', async () => {
    const db = makeDb([[makeShareLinkRow()]]);

    const result = await createShareLink(CAMPAIGN_ID, EVENT_ID, FAN_USER_ID, db);

    expect(result.eventId).toBe(EVENT_ID);
    expect(result.shareCode).toBe(SHARE_CODE);
    expect(result.shareUrl).toContain('/r/');
    expect(result.shareUrl).toContain(SHARE_CODE);
  });
});

describe('trackClick', () => {
  it('zaznamenává klik na sdílecí odkaz', async () => {
    const db = makeDb([[makeShareLinkRow({ referral_count: 1 })]]);

    const result = await trackClick(SHARE_CODE, db);

    expect(result).not.toBeNull();
    expect(result?.referralCount).toBe(1);
  });

  it('vrátí null pro neexistující nebo neaktivní odkaz', async () => {
    const db = makeDb([[]]);

    const result = await trackClick('invalid-code', db);

    expect(result).toBeNull();
  });
});

describe('recordConversion', () => {
  it('zaznamenává konverzi a vydá odměnu', async () => {
    const db = makeDb([
      [{
        ...makeShareLinkRow(),
        reward_type: 'cashback',
        reward_value_hellers: 50000,
        reward_discount_pct: null,
        reward_code_prefix: null,
      }],  // share link + campaign data
      [makeConversionRow()],  // conversion insert
      undefined as any,  // update share link counts
    ]);

    const result = await recordConversion(SHARE_CODE, ORDER_ID, 'user-002', db);

    expect(result.orderId).toBe(ORDER_ID);
    expect(result.rewardIssued).toBe(true);
    expect(result.rewardValueHellers).toBe(50000);
  });

  it('vydá discount kód pro reward_type=discount_code', async () => {
    const db = makeDb([
      [{
        ...makeShareLinkRow(),
        reward_type: 'discount_code',
        reward_value_hellers: null,
        reward_discount_pct: 10,
        reward_code_prefix: 'FANSHARE-',
      }],
      [makeConversionRow({ reward_type: 'discount_code', reward_code: 'FANSHARE-AbCd1234', reward_value_hellers: null })],
      undefined as any,
    ]);

    const result = await recordConversion(SHARE_CODE, ORDER_ID, 'user-002', db);

    expect(result.rewardType).toBe('discount_code');
    expect(result.rewardCode).toContain('FANSHARE-');
  });

  it('vyhodí chybu pokud odkaz neexistuje', async () => {
    const db = makeDb([[]], vi.fn());

    await expect(
      recordConversion('nonexistent', ORDER_ID, 'user-002', db),
    ).rejects.toThrow('SHARE_LINK_NOT_FOUND');
  });
});

describe('getFanShareLink', () => {
  it('vrátí sdílecí odkaz pro fana a event', async () => {
    const db = makeDb([[makeShareLinkRow()]]);

    const result = await getFanShareLink(EVENT_ID, FAN_USER_ID, db);

    expect(result).not.toBeNull();
    expect(result?.fanUserId).toBe(FAN_USER_ID);
  });

  it('vrátí null pokud odkaz neexistuje', async () => {
    const db = makeDb([[]]);

    const result = await getFanShareLink(EVENT_ID, 'unknown-user', db);

    expect(result).toBeNull();
  });
});

describe('getShareLinkConversions', () => {
  it('vrátí seznam konverzí pro sdílecí odkaz', async () => {
    const db = makeDb([[
      makeConversionRow({ id: 'conv-001' }),
      makeConversionRow({ id: 'conv-002', order_id: 'order-002' }),
    ]]);

    const result = await getShareLinkConversions(SHARE_CODE, db);

    expect(result).toHaveLength(2);
    expect(result[0].rewardIssued).toBe(true);
  });
});

describe('getCampaign', () => {
  it('vrátí detail kampaně', async () => {
    const db = makeDb([[makeCampaignRow()]]);

    const result = await getCampaign(CAMPAIGN_ID, db);

    expect(result).not.toBeNull();
    expect(result?.promoterId).toBe(PROMOTER_ID);
  });
});

describe('getEventCampaigns', () => {
  it('vrátí aktivní kampaně pro event', async () => {
    const db = makeDb([[
      makeCampaignRow({ id: 'c1' }),
      makeCampaignRow({ id: 'c2', reward_type: 'vip_upgrade' }),
    ]]);

    const result = await getEventCampaigns(EVENT_ID, db);

    expect(result).toHaveLength(2);
    expect(result[1].rewardType).toBe('vip_upgrade');
  });
});
