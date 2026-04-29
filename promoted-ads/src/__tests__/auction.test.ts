import { describe, it, expect } from 'vitest';
import {
  runSecondPriceAuction,
  filterEligibleCampaigns,
  calculateEffectiveBid,
} from '../lib/auction';
import type { AdCampaign, AuctionContext } from '../types/promoted-ads.types';

function makeCampaign(overrides: Partial<AdCampaign> = {}): AdCampaign {
  return {
    id: 'c1',
    promoterId: 'p1',
    eventId: 'e1',
    name: 'Campaign',
    status: 'active',
    bidStrategy: 'manual_cpc',
    maxCpcBidCzk: 1000,
    dailyBudgetCzk: 10000,
    totalBudgetCzk: 100000,
    spentTotalCzk: 0,
    spentTodayCzk: 0,
    targetCities: [],
    targetCategories: [],
    startsAt: new Date('2026-01-01'),
    endsAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

const DEFAULT_CONTEXT: AuctionContext = {
  placement: 'home_feed',
  city: 'Praha',
  category: 'concert',
  userId: null,
};

const NOW = new Date('2026-06-01T12:00:00Z');

describe('runSecondPriceAuction', () => {
  it('returns null for empty candidates', () => {
    expect(runSecondPriceAuction([])).toBeNull();
  });

  it('returns null when effective bids are all zero', () => {
    const c = makeCampaign({ id: 'a' });
    const result = runSecondPriceAuction([{ campaign: c, effectiveBid: 0 }]);
    expect(result).toBeNull();
  });

  it('single candidate pays reserve price (50% of maxBid)', () => {
    const c = makeCampaign({ id: 'a', maxCpcBidCzk: 1000 });
    const result = runSecondPriceAuction([{ campaign: c, effectiveBid: 1000 }]);
    expect(result).not.toBeNull();
    expect(result!.winner.id).toBe('a');
    expect(result!.chargeAmountCzk).toBe(500);
  });

  it('single candidate reserve does not exceed effective bid', () => {
    const c = makeCampaign({ id: 'a', maxCpcBidCzk: 1000 });
    // Effective bid only 200 (budget-constrained); reserve would be 500,
    // but we cap at effective.
    const result = runSecondPriceAuction([{ campaign: c, effectiveBid: 200 }]);
    expect(result!.chargeAmountCzk).toBe(200);
  });

  it('two candidates — winner pays second price + 1', () => {
    const a = makeCampaign({ id: 'a', maxCpcBidCzk: 1000 });
    const b = makeCampaign({ id: 'b', maxCpcBidCzk: 500 });
    const result = runSecondPriceAuction([
      { campaign: a, effectiveBid: 1000 },
      { campaign: b, effectiveBid: 500 },
    ]);
    expect(result!.winner.id).toBe('a');
    expect(result!.chargeAmountCzk).toBe(501);
  });

  it('three candidates — winner pays second-highest + 1', () => {
    const a = makeCampaign({ id: 'a', maxCpcBidCzk: 2000 });
    const b = makeCampaign({ id: 'b', maxCpcBidCzk: 1500 });
    const c = makeCampaign({ id: 'c', maxCpcBidCzk: 800 });
    const result = runSecondPriceAuction([
      { campaign: a, effectiveBid: 2000 },
      { campaign: b, effectiveBid: 1500 },
      { campaign: c, effectiveBid: 800 },
    ]);
    expect(result!.winner.id).toBe('a');
    expect(result!.chargeAmountCzk).toBe(1501);
  });

  it('charge does not exceed winner maxCpcBid', () => {
    const a = makeCampaign({ id: 'a', maxCpcBidCzk: 1000 });
    const b = makeCampaign({ id: 'b', maxCpcBidCzk: 999 });
    const result = runSecondPriceAuction([
      { campaign: a, effectiveBid: 1000 },
      { campaign: b, effectiveBid: 999 },
    ]);
    // second + 1 = 1000, bounded by maxCpcBid 1000
    expect(result!.chargeAmountCzk).toBe(1000);
  });

  it('tie broken by earlier createdAt', () => {
    const older = makeCampaign({
      id: 'older',
      createdAt: new Date('2026-01-01'),
      maxCpcBidCzk: 1000,
    });
    const newer = makeCampaign({
      id: 'newer',
      createdAt: new Date('2026-02-01'),
      maxCpcBidCzk: 1000,
    });
    const result = runSecondPriceAuction([
      { campaign: newer, effectiveBid: 1000 },
      { campaign: older, effectiveBid: 1000 },
    ]);
    expect(result!.winner.id).toBe('older');
  });

  it('charge always at least 1 haléř', () => {
    const a = makeCampaign({ id: 'a', maxCpcBidCzk: 2 });
    const result = runSecondPriceAuction([{ campaign: a, effectiveBid: 2 }]);
    // reserve = floor(2/2) = 1
    expect(result!.chargeAmountCzk).toBeGreaterThanOrEqual(1);
  });
});

describe('filterEligibleCampaigns', () => {
  it('filters out non-active status', () => {
    const draft = makeCampaign({ id: 'd', status: 'draft' });
    const active = makeCampaign({ id: 'a', status: 'active' });
    const paused = makeCampaign({ id: 'p', status: 'paused' });
    const result = filterEligibleCampaigns(
      [draft, active, paused],
      DEFAULT_CONTEXT,
      NOW,
    );
    expect(result.map((c) => c.id)).toEqual(['a']);
  });

  it('filters out campaigns before startsAt', () => {
    const future = makeCampaign({
      id: 'f',
      startsAt: new Date('2027-01-01'),
    });
    expect(filterEligibleCampaigns([future], DEFAULT_CONTEXT, NOW)).toEqual([]);
  });

  it('filters out campaigns after endsAt', () => {
    const expired = makeCampaign({
      id: 'e',
      endsAt: new Date('2026-01-01'),
    });
    expect(filterEligibleCampaigns([expired], DEFAULT_CONTEXT, NOW)).toEqual([]);
  });

  it('keeps campaigns with null endsAt (forever)', () => {
    const forever = makeCampaign({ id: 'forever', endsAt: null });
    expect(
      filterEligibleCampaigns([forever], DEFAULT_CONTEXT, NOW).length,
    ).toBe(1);
  });

  it('filters out campaigns over total budget', () => {
    const exhausted = makeCampaign({
      id: 'x',
      totalBudgetCzk: 1000,
      spentTotalCzk: 1000,
    });
    expect(filterEligibleCampaigns([exhausted], DEFAULT_CONTEXT, NOW)).toEqual(
      [],
    );
  });

  it('filters out campaigns over daily budget', () => {
    const exhausted = makeCampaign({
      id: 'x',
      dailyBudgetCzk: 500,
      spentTodayCzk: 500,
    });
    expect(filterEligibleCampaigns([exhausted], DEFAULT_CONTEXT, NOW)).toEqual(
      [],
    );
  });

  it('empty targetCities = all cities match', () => {
    const c = makeCampaign({ id: 'a', targetCities: [] });
    expect(
      filterEligibleCampaigns([c], { ...DEFAULT_CONTEXT, city: 'Ostrava' }, NOW)
        .length,
    ).toBe(1);
  });

  it('targetCities restricts to listed cities', () => {
    const c = makeCampaign({ id: 'a', targetCities: ['Praha', 'Brno'] });
    expect(
      filterEligibleCampaigns([c], { ...DEFAULT_CONTEXT, city: 'Ostrava' }, NOW)
        .length,
    ).toBe(0);
    expect(
      filterEligibleCampaigns([c], { ...DEFAULT_CONTEXT, city: 'Praha' }, NOW)
        .length,
    ).toBe(1);
  });

  it('targetCities requires non-null context city', () => {
    const c = makeCampaign({ id: 'a', targetCities: ['Praha'] });
    expect(
      filterEligibleCampaigns([c], { ...DEFAULT_CONTEXT, city: null }, NOW)
        .length,
    ).toBe(0);
  });

  it('targetCategories restricts categories', () => {
    const c = makeCampaign({ id: 'a', targetCategories: ['concert'] });
    expect(
      filterEligibleCampaigns(
        [c],
        { ...DEFAULT_CONTEXT, category: 'theater' },
        NOW,
      ).length,
    ).toBe(0);
    expect(
      filterEligibleCampaigns(
        [c],
        { ...DEFAULT_CONTEXT, category: 'concert' },
        NOW,
      ).length,
    ).toBe(1);
  });
});

describe('calculateEffectiveBid', () => {
  it('returns maxBid when budget is plenty', () => {
    const c = makeCampaign({
      maxCpcBidCzk: 500,
      dailyBudgetCzk: 10000,
      spentTodayCzk: 0,
      totalBudgetCzk: 100000,
      spentTotalCzk: 0,
    });
    expect(calculateEffectiveBid(c, NOW)).toBe(500);
  });

  it('caps bid to remaining daily budget', () => {
    const c = makeCampaign({
      maxCpcBidCzk: 500,
      dailyBudgetCzk: 1000,
      spentTodayCzk: 800, // remaining 200
    });
    expect(calculateEffectiveBid(c, NOW)).toBe(200);
  });

  it('caps bid to remaining total budget', () => {
    const c = makeCampaign({
      maxCpcBidCzk: 500,
      dailyBudgetCzk: 10000,
      spentTodayCzk: 0,
      totalBudgetCzk: 1000,
      spentTotalCzk: 850, // remaining 150
    });
    expect(calculateEffectiveBid(c, NOW)).toBe(150);
  });

  it('returns 0 when budget fully depleted', () => {
    const c = makeCampaign({
      maxCpcBidCzk: 500,
      dailyBudgetCzk: 1000,
      spentTodayCzk: 1000,
    });
    expect(calculateEffectiveBid(c, NOW)).toBe(0);
  });
});
