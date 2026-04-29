import { describe, it, expect, beforeEach } from 'vitest';
import {
  activateCampaign,
  createCampaign,
  endExpiredCampaigns,
  getCampaignMetrics,
  pauseCampaign,
  recordClick,
  recordImpression,
  resetDailyBudgets,
  runAuction,
} from '../services/promoted-ads.service';
import {
  type AuctionContext,
  type CampaignInput,
  type DbAdapter,
  PromotedAdsError,
  type ServiceDeps,
} from '../types/promoted-ads.types';

// ---------------------------------------------------------------------------
// In-memory DB adapter — minimální podpora pro unit testy
// ---------------------------------------------------------------------------

interface CampaignRow {
  id: string;
  promoter_id: string;
  event_id: string;
  name: string;
  status: string;
  bid_strategy: string;
  max_cpc_bid_czk: number;
  daily_budget_czk: number;
  total_budget_czk: number;
  spent_total_czk: number;
  spent_today_czk: number;
  target_cities: string[];
  target_categories: string[];
  starts_at: Date;
  ends_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ImpressionRow {
  id: string;
  campaign_id: string;
  user_id: string | null;
  placement: string;
  city: string | null;
  category: string | null;
  cpc_bid_czk: number;
  occurred_at: Date;
}

interface ClickRow {
  id: string;
  campaign_id: string;
  impression_id: string;
  user_id: string | null;
  cost_czk: number;
  occurred_at: Date;
}

class MemoryDb implements DbAdapter {
  campaigns: CampaignRow[] = [];
  impressions: ImpressionRow[] = [];
  clicks: ClickRow[] = [];
  conversions: Array<{ campaign_id: string }> = [];

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const s = sql.trim();

    // SELECT * FROM ad_campaigns WHERE id = $1
    if (/FROM\s+ad_campaigns\s+WHERE\s+id\s*=/i.test(s)) {
      const id = params[0] as string;
      return this.campaigns.filter((c) => c.id === id) as unknown as T[];
    }
    // SELECT * FROM ad_campaigns WHERE status = 'active'
    if (/FROM\s+ad_campaigns\s+WHERE\s+status\s*=\s*'active'/i.test(s)) {
      return this.campaigns.filter((c) => c.status === 'active') as unknown as T[];
    }
    // SELECT * FROM ad_impressions WHERE id = $1
    if (/FROM\s+ad_impressions\s+WHERE\s+id\s*=/i.test(s)) {
      const id = params[0] as string;
      return this.impressions.filter((i) => i.id === id) as unknown as T[];
    }
    // SELECT * FROM ad_clicks WHERE impression_id = $1
    if (/FROM\s+ad_clicks\s+WHERE\s+impression_id\s*=/i.test(s)) {
      const id = params[0] as string;
      return this.clicks.filter((c) => c.impression_id === id) as unknown as T[];
    }
    // COUNT(*) FROM ad_impressions WHERE campaign_id = $1
    if (/COUNT\(\*\).*FROM\s+ad_impressions\s+WHERE\s+campaign_id/i.test(s)) {
      const id = params[0] as string;
      const count = this.impressions.filter((i) => i.campaign_id === id).length;
      return [{ count }] as unknown as T[];
    }
    // COUNT(*) FROM ad_clicks WHERE campaign_id = $1
    if (/COUNT\(\*\).*FROM\s+ad_clicks\s+WHERE\s+campaign_id/i.test(s)) {
      const id = params[0] as string;
      const count = this.clicks.filter((c) => c.campaign_id === id).length;
      return [{ count }] as unknown as T[];
    }
    // COUNT(*) FROM ad_conversions WHERE campaign_id = $1
    if (/COUNT\(\*\).*FROM\s+ad_conversions\s+WHERE\s+campaign_id/i.test(s)) {
      const id = params[0] as string;
      const count = this.conversions.filter((c) => c.campaign_id === id).length;
      return [{ count }] as unknown as T[];
    }

    throw new Error(`Unhandled query: ${s}`);
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    const s = sql.trim();

    // INSERT INTO ad_campaigns
    if (/^INSERT\s+INTO\s+ad_campaigns/i.test(s)) {
      const [
        id, promoter_id, event_id, name, bid_strategy,
        max_cpc, daily_budget, total_budget,
        target_cities, target_categories,
        starts_at, ends_at, created_at,
      ] = params as [
        string, string, string, string, string,
        number, number, number,
        string, string,
        Date, Date | null, Date,
      ];
      this.campaigns.push({
        id,
        promoter_id,
        event_id,
        name,
        status: 'draft',
        bid_strategy,
        max_cpc_bid_czk: max_cpc,
        daily_budget_czk: daily_budget,
        total_budget_czk: total_budget,
        spent_total_czk: 0,
        spent_today_czk: 0,
        target_cities: JSON.parse(target_cities),
        target_categories: JSON.parse(target_categories),
        starts_at,
        ends_at,
        created_at,
        updated_at: created_at,
      });
      return;
    }

    // UPDATE ad_campaigns SET status = 'active' / 'paused' / 'budget_exhausted' / 'ended'
    const statusUpdateMatch = s.match(
      /UPDATE\s+ad_campaigns\s+SET\s+status\s*=\s*'(\w+)',\s+updated_at\s*=\s*\$1\s+WHERE\s+id\s*=\s*\$2/i,
    );
    if (statusUpdateMatch) {
      const newStatus = statusUpdateMatch[1]!;
      const updated_at = params[0] as Date;
      const id = params[1] as string;
      const c = this.campaigns.find((x) => x.id === id);
      if (c) {
        c.status = newStatus;
        c.updated_at = updated_at;
      }
      return;
    }

    // UPDATE ... SET spent_total_czk = spent_total_czk + $1, spent_today_czk = ...
    if (/spent_total_czk\s*=\s*spent_total_czk\s*\+/i.test(s)) {
      const delta = params[0] as number;
      const updated_at = params[1] as Date;
      const id = params[2] as string;
      const c = this.campaigns.find((x) => x.id === id);
      if (c) {
        c.spent_total_czk += delta;
        c.spent_today_czk += delta;
        c.updated_at = updated_at;
      }
      return;
    }

    // Reset daily budgets — reactivate exhausted under total
    if (
      /UPDATE\s+ad_campaigns\s+SET\s+status\s*=\s*'active'.*budget_exhausted.*spent_total_czk\s*<\s*total_budget_czk/is.test(
        s,
      )
    ) {
      const updated_at = params[0] as Date;
      for (const c of this.campaigns) {
        if (
          c.status === 'budget_exhausted' &&
          c.spent_total_czk < c.total_budget_czk
        ) {
          c.status = 'active';
          c.updated_at = updated_at;
        }
      }
      return;
    }

    // UPDATE ad_campaigns SET spent_today_czk = 0
    if (/UPDATE\s+ad_campaigns\s+SET\s+spent_today_czk\s*=\s*0/i.test(s)) {
      const updated_at = params[0] as Date;
      for (const c of this.campaigns) {
        c.spent_today_czk = 0;
        c.updated_at = updated_at;
      }
      return;
    }

    // End expired campaigns
    if (/status\s*=\s*'ended'/i.test(s) && /ends_at\s+IS\s+NOT\s+NULL/i.test(s)) {
      const now = params[0] as Date;
      for (const c of this.campaigns) {
        if (
          c.status === 'active' &&
          c.ends_at !== null &&
          c.ends_at.getTime() <= now.getTime()
        ) {
          c.status = 'ended';
          c.updated_at = now;
        }
      }
      return;
    }

    // INSERT INTO ad_impressions
    if (/^INSERT\s+INTO\s+ad_impressions/i.test(s)) {
      const [
        id, campaign_id, user_id, placement, city, category, cpc_bid, occurred_at,
      ] = params as [string, string, string | null, string, string | null, string | null, number, Date];
      this.impressions.push({
        id,
        campaign_id,
        user_id,
        placement,
        city,
        category,
        cpc_bid_czk: cpc_bid,
        occurred_at,
      });
      return;
    }

    // INSERT INTO ad_clicks
    if (/^INSERT\s+INTO\s+ad_clicks/i.test(s)) {
      const [id, campaign_id, impression_id, user_id, cost_czk, occurred_at] =
        params as [string, string, string, string | null, number, Date];
      this.clicks.push({
        id,
        campaign_id,
        impression_id,
        user_id,
        cost_czk,
        occurred_at,
      });
      return;
    }

    throw new Error(`Unhandled execute: ${s}`);
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    // Naivní implementace — no isolation, but sufficient for unit tests
    return fn(this);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(nowDate: Date = new Date('2026-06-01T12:00:00Z')): ServiceDeps & {
  db: MemoryDb;
} {
  const db = new MemoryDb();
  return {
    db,
    now: () => nowDate,
  };
}

function defaultInput(overrides: Partial<CampaignInput> = {}): CampaignInput {
  return {
    promoterId: 'promoter-1',
    eventId: 'event-1',
    name: 'Summer Campaign',
    bidStrategy: 'manual_cpc',
    maxCpcBidCzk: 1000,
    dailyBudgetCzk: 10000,
    totalBudgetCzk: 100000,
    targetCities: [],
    targetCategories: [],
    startsAt: new Date('2026-05-01'),
    ...overrides,
  };
}

const DEFAULT_CONTEXT: AuctionContext = {
  placement: 'home_feed',
  city: 'Praha',
  category: 'concert',
  userId: 'user-1',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createCampaign', () => {
  it('creates campaign in draft status', async () => {
    const deps = makeDeps();
    const campaign = await createCampaign(defaultInput(), deps);
    expect(campaign.status).toBe('draft');
    expect(campaign.spentTotalCzk).toBe(0);
    expect(campaign.spentTodayCzk).toBe(0);
    expect(deps.db.campaigns.length).toBe(1);
  });

  it('rejects dailyBudget <= 0', async () => {
    const deps = makeDeps();
    await expect(
      createCampaign(defaultInput({ dailyBudgetCzk: 0 }), deps),
    ).rejects.toMatchObject({ code: 'INVALID_BUDGET' });
  });

  it('rejects totalBudget < dailyBudget', async () => {
    const deps = makeDeps();
    await expect(
      createCampaign(
        defaultInput({ dailyBudgetCzk: 5000, totalBudgetCzk: 1000 }),
        deps,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_BUDGET' });
  });

  it('rejects maxCpcBid <= 0', async () => {
    const deps = makeDeps();
    await expect(
      createCampaign(defaultInput({ maxCpcBidCzk: 0 }), deps),
    ).rejects.toMatchObject({ code: 'INVALID_BID' });
  });

  it('rejects endsAt before or equal to startsAt', async () => {
    const deps = makeDeps();
    await expect(
      createCampaign(
        defaultInput({
          startsAt: new Date('2026-06-01'),
          endsAt: new Date('2026-05-01'),
        }),
        deps,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE' });
  });

  it('accepts endsAt after startsAt', async () => {
    const deps = makeDeps();
    const c = await createCampaign(
      defaultInput({
        startsAt: new Date('2026-05-01'),
        endsAt: new Date('2026-09-01'),
      }),
      deps,
    );
    expect(c.endsAt).not.toBeNull();
  });
});

describe('campaign lifecycle', () => {
  it('activateCampaign draft -> active', async () => {
    const deps = makeDeps();
    const c = await createCampaign(defaultInput(), deps);
    const activated = await activateCampaign(c.id, c.promoterId, deps);
    expect(activated.status).toBe('active');
  });

  it('activateCampaign paused -> active', async () => {
    const deps = makeDeps();
    const c = await createCampaign(defaultInput(), deps);
    await activateCampaign(c.id, c.promoterId, deps);
    await pauseCampaign(c.id, c.promoterId, deps);
    const reactivated = await activateCampaign(c.id, c.promoterId, deps);
    expect(reactivated.status).toBe('active');
  });

  it('activateCampaign rejects for other promoter', async () => {
    const deps = makeDeps();
    const c = await createCampaign(defaultInput(), deps);
    await expect(
      activateCampaign(c.id, 'other-promoter', deps),
    ).rejects.toMatchObject({ code: 'CAMPAIGN_NOT_OWNED_BY_PROMOTER' });
  });

  it('activateCampaign rejects for non-existent campaign', async () => {
    const deps = makeDeps();
    await expect(
      activateCampaign('nonexistent', 'promoter-1', deps),
    ).rejects.toMatchObject({ code: 'CAMPAIGN_NOT_FOUND' });
  });

  it('pauseCampaign active -> paused', async () => {
    const deps = makeDeps();
    const c = await createCampaign(defaultInput(), deps);
    await activateCampaign(c.id, c.promoterId, deps);
    const paused = await pauseCampaign(c.id, c.promoterId, deps);
    expect(paused.status).toBe('paused');
  });

  it('pauseCampaign rejects draft status', async () => {
    const deps = makeDeps();
    const c = await createCampaign(defaultInput(), deps);
    await expect(
      pauseCampaign(c.id, c.promoterId, deps),
    ).rejects.toMatchObject({ code: 'CAMPAIGN_NOT_PAUSEABLE' });
  });
});

describe('runAuction', () => {
  it('returns null when no active campaigns', async () => {
    const deps = makeDeps();
    const winner = await runAuction(DEFAULT_CONTEXT, deps);
    expect(winner).toBeNull();
  });

  it('returns null when only draft campaigns exist', async () => {
    const deps = makeDeps();
    await createCampaign(defaultInput(), deps);
    const winner = await runAuction(DEFAULT_CONTEXT, deps);
    expect(winner).toBeNull();
  });

  it('single active campaign wins at reserve price', async () => {
    const deps = makeDeps();
    const c = await createCampaign(defaultInput({ maxCpcBidCzk: 1000 }), deps);
    await activateCampaign(c.id, c.promoterId, deps);
    const winner = await runAuction(DEFAULT_CONTEXT, deps);
    expect(winner).not.toBeNull();
    expect(winner!.campaign.id).toBe(c.id);
    expect(winner!.cpcBidCzk).toBe(500);
  });

  it('higher bidder wins with second price charge', async () => {
    const deps = makeDeps();
    const lo = await createCampaign(
      defaultInput({ name: 'low', maxCpcBidCzk: 500 }),
      deps,
    );
    const hi = await createCampaign(
      defaultInput({ name: 'high', maxCpcBidCzk: 1000 }),
      deps,
    );
    await activateCampaign(lo.id, lo.promoterId, deps);
    await activateCampaign(hi.id, hi.promoterId, deps);
    const winner = await runAuction(DEFAULT_CONTEXT, deps);
    expect(winner!.campaign.id).toBe(hi.id);
    expect(winner!.cpcBidCzk).toBe(501);
  });

  it('filters campaigns by target city', async () => {
    const deps = makeDeps();
    const praha = await createCampaign(
      defaultInput({ name: 'p', targetCities: ['Praha'] }),
      deps,
    );
    const brno = await createCampaign(
      defaultInput({ name: 'b', targetCities: ['Brno'] }),
      deps,
    );
    await activateCampaign(praha.id, praha.promoterId, deps);
    await activateCampaign(brno.id, brno.promoterId, deps);
    const winner = await runAuction(
      { ...DEFAULT_CONTEXT, city: 'Praha' },
      deps,
    );
    expect(winner!.campaign.id).toBe(praha.id);
  });

  it('filters campaigns by target category', async () => {
    const deps = makeDeps();
    const concert = await createCampaign(
      defaultInput({ name: 'c', targetCategories: ['concert'] }),
      deps,
    );
    const theater = await createCampaign(
      defaultInput({ name: 't', targetCategories: ['theater'] }),
      deps,
    );
    await activateCampaign(concert.id, concert.promoterId, deps);
    await activateCampaign(theater.id, theater.promoterId, deps);
    const winner = await runAuction(
      { ...DEFAULT_CONTEXT, category: 'theater' },
      deps,
    );
    expect(winner!.campaign.id).toBe(theater.id);
  });
});

describe('recordImpression', () => {
  it('records impression with all fields', async () => {
    const deps = makeDeps();
    const c = await createCampaign(defaultInput(), deps);
    const imp = await recordImpression(c.id, DEFAULT_CONTEXT, 250, deps);
    expect(imp.campaignId).toBe(c.id);
    expect(imp.cpcBidCzk).toBe(250);
    expect(imp.placement).toBe('home_feed');
    expect(imp.city).toBe('Praha');
    expect(deps.db.impressions.length).toBe(1);
  });
});

describe('recordClick', () => {
  it('records click and increments campaign spent', async () => {
    const deps = makeDeps();
    const c = await createCampaign(defaultInput(), deps);
    await activateCampaign(c.id, c.promoterId, deps);
    const imp = await recordImpression(c.id, DEFAULT_CONTEXT, 300, deps);
    const click = await recordClick(imp.id, deps);
    expect(click.costCzk).toBe(300);
    expect(click.impressionId).toBe(imp.id);
    const after = deps.db.campaigns.find((x) => x.id === c.id)!;
    expect(after.spent_total_czk).toBe(300);
    expect(after.spent_today_czk).toBe(300);
  });

  it('rejects click for non-existent impression', async () => {
    const deps = makeDeps();
    await expect(recordClick('nonexistent', deps)).rejects.toMatchObject({
      code: 'IMPRESSION_NOT_FOUND',
    });
  });

  it('is idempotent — second click rejected', async () => {
    const deps = makeDeps();
    const c = await createCampaign(defaultInput(), deps);
    await activateCampaign(c.id, c.promoterId, deps);
    const imp = await recordImpression(c.id, DEFAULT_CONTEXT, 300, deps);
    await recordClick(imp.id, deps);
    await expect(recordClick(imp.id, deps)).rejects.toMatchObject({
      code: 'CLICK_ALREADY_RECORDED',
    });
  });

  it('marks campaign budget_exhausted when total budget reached', async () => {
    const deps = makeDeps();
    const c = await createCampaign(
      defaultInput({
        maxCpcBidCzk: 500,
        dailyBudgetCzk: 500,
        totalBudgetCzk: 500,
      }),
      deps,
    );
    await activateCampaign(c.id, c.promoterId, deps);
    const imp = await recordImpression(c.id, DEFAULT_CONTEXT, 500, deps);
    await recordClick(imp.id, deps);
    const after = deps.db.campaigns.find((x) => x.id === c.id)!;
    expect(after.status).toBe('budget_exhausted');
  });

  it('marks budget_exhausted when daily budget reached', async () => {
    const deps = makeDeps();
    const c = await createCampaign(
      defaultInput({
        maxCpcBidCzk: 200,
        dailyBudgetCzk: 200,
        totalBudgetCzk: 10000,
      }),
      deps,
    );
    await activateCampaign(c.id, c.promoterId, deps);
    const imp = await recordImpression(c.id, DEFAULT_CONTEXT, 200, deps);
    await recordClick(imp.id, deps);
    const after = deps.db.campaigns.find((x) => x.id === c.id)!;
    expect(after.status).toBe('budget_exhausted');
  });
});

describe('getCampaignMetrics', () => {
  it('returns zeroed metrics for new campaign', async () => {
    const deps = makeDeps();
    const c = await createCampaign(defaultInput(), deps);
    const metrics = await getCampaignMetrics(c.id, deps);
    expect(metrics.impressions).toBe(0);
    expect(metrics.clicks).toBe(0);
    expect(metrics.ctr).toBe(0);
    expect(metrics.averageCpcCzk).toBe(0);
  });

  it('computes CTR and averageCpc correctly', async () => {
    const deps = makeDeps();
    const c = await createCampaign(defaultInput(), deps);
    await activateCampaign(c.id, c.promoterId, deps);
    // 4 impressions, 2 clicks at 100 each
    for (let i = 0; i < 4; i++) {
      await recordImpression(c.id, DEFAULT_CONTEXT, 100, deps);
    }
    await recordClick(deps.db.impressions[0]!.id, deps);
    await recordClick(deps.db.impressions[1]!.id, deps);
    const metrics = await getCampaignMetrics(c.id, deps);
    expect(metrics.impressions).toBe(4);
    expect(metrics.clicks).toBe(2);
    expect(metrics.ctr).toBeCloseTo(0.5);
    expect(metrics.averageCpcCzk).toBe(100);
    expect(metrics.spentTotalCzk).toBe(200);
  });
});

describe('resetDailyBudgets', () => {
  it('resets spent_today_czk for all campaigns', async () => {
    const deps = makeDeps();
    const c = await createCampaign(defaultInput(), deps);
    deps.db.campaigns[0]!.spent_today_czk = 5000;
    await resetDailyBudgets(deps);
    expect(deps.db.campaigns[0]!.spent_today_czk).toBe(0);
    // Just to reference c for lint
    expect(c.id).toBe(deps.db.campaigns[0]!.id);
  });

  it('reactivates budget_exhausted campaigns that have room in total', async () => {
    const deps = makeDeps();
    const c = await createCampaign(
      defaultInput({ dailyBudgetCzk: 1000, totalBudgetCzk: 10000 }),
      deps,
    );
    // Simulate daily budget exhaustion
    deps.db.campaigns[0]!.status = 'budget_exhausted';
    deps.db.campaigns[0]!.spent_today_czk = 1000;
    deps.db.campaigns[0]!.spent_total_czk = 1000;
    await resetDailyBudgets(deps);
    const after = deps.db.campaigns.find((x) => x.id === c.id)!;
    expect(after.status).toBe('active');
    expect(after.spent_today_czk).toBe(0);
  });

  it('does NOT reactivate when total budget is fully spent', async () => {
    const deps = makeDeps();
    const c = await createCampaign(
      defaultInput({ dailyBudgetCzk: 1000, totalBudgetCzk: 1000 }),
      deps,
    );
    deps.db.campaigns[0]!.status = 'budget_exhausted';
    deps.db.campaigns[0]!.spent_today_czk = 1000;
    deps.db.campaigns[0]!.spent_total_czk = 1000;
    await resetDailyBudgets(deps);
    const after = deps.db.campaigns.find((x) => x.id === c.id)!;
    expect(after.status).toBe('budget_exhausted');
  });
});

describe('endExpiredCampaigns', () => {
  it('ends active campaigns whose endsAt has passed', async () => {
    const now = new Date('2026-06-01');
    const deps = makeDeps(now);
    const c = await createCampaign(
      defaultInput({
        startsAt: new Date('2026-05-01'),
        endsAt: new Date('2026-05-15'),
      }),
      deps,
    );
    await activateCampaign(c.id, c.promoterId, deps);
    await endExpiredCampaigns(deps);
    const after = deps.db.campaigns.find((x) => x.id === c.id)!;
    expect(after.status).toBe('ended');
  });

  it('leaves active campaigns with future endsAt untouched', async () => {
    const now = new Date('2026-06-01');
    const deps = makeDeps(now);
    const c = await createCampaign(
      defaultInput({
        startsAt: new Date('2026-05-01'),
        endsAt: new Date('2026-12-31'),
      }),
      deps,
    );
    await activateCampaign(c.id, c.promoterId, deps);
    await endExpiredCampaigns(deps);
    const after = deps.db.campaigns.find((x) => x.id === c.id)!;
    expect(after.status).toBe('active');
  });

  it('leaves campaigns with null endsAt (run forever) untouched', async () => {
    const now = new Date('2030-01-01');
    const deps = makeDeps(now);
    const c = await createCampaign(defaultInput({ endsAt: undefined }), deps);
    await activateCampaign(c.id, c.promoterId, deps);
    await endExpiredCampaigns(deps);
    const after = deps.db.campaigns.find((x) => x.id === c.id)!;
    expect(after.status).toBe('active');
  });
});

describe('PromotedAdsError', () => {
  it('has name and code', () => {
    const e = new PromotedAdsError('CAMPAIGN_NOT_FOUND', 'missing');
    expect(e.name).toBe('PromotedAdsError');
    expect(e.code).toBe('CAMPAIGN_NOT_FOUND');
    expect(e.message).toBe('missing');
  });
});
