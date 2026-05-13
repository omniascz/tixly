// =============================================================================
// Promoted Ads Service (Feature #52)
//
// CPC reklamní platforma — lifecycle kampaní, auction, billing za kliky.
// =============================================================================

import { randomUUID } from 'crypto';
import {
  type AdCampaign,
  type AdClick,
  type AdImpression,
  type AuctionContext,
  type AuctionWinner,
  type CampaignInput,
  type CampaignMetrics,
  type CampaignStatus,
  type DbAdapter,
  PromotedAdsError,
  type ServiceDeps,
} from '../types/promoted-ads.types';
import {
  calculateEffectiveBid,
  filterEligibleCampaigns,
  runSecondPriceAuction,
} from '../lib/auction';

// ---------------------------------------------------------------------------
// DB row types (snake_case from SQL)
// ---------------------------------------------------------------------------

interface CampaignRow {
  id: string;
  promoter_id: string;
  event_id: string;
  name: string;
  status: CampaignStatus;
  bid_strategy: 'manual_cpc' | 'auto_cpc';
  max_cpc_bid_czk: number;
  daily_budget_czk: number;
  total_budget_czk: number;
  spent_total_czk: number;
  spent_today_czk: number;
  target_cities: string[] | string; // JSON in some drivers
  target_categories: string[] | string;
  starts_at: Date | string;
  ends_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ImpressionRow {
  id: string;
  campaign_id: string;
  user_id: string | null;
  placement: string;
  city: string | null;
  category: string | null;
  cpc_bid_czk: number;
  occurred_at: Date | string;
}

interface ClickRow {
  id: string;
  campaign_id: string;
  impression_id: string;
  user_id: string | null;
  cost_czk: number;
  occurred_at: Date | string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

function toDateOrNull(v: Date | string | null): Date | null {
  if (v === null) return null;
  return toDate(v);
}

function toStringArray(v: string[] | string | null | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapCampaign(row: CampaignRow): AdCampaign {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    eventId: row.event_id,
    name: row.name,
    status: row.status,
    bidStrategy: row.bid_strategy,
    maxCpcBidCzk: Number(row.max_cpc_bid_czk),
    dailyBudgetCzk: Number(row.daily_budget_czk),
    totalBudgetCzk: Number(row.total_budget_czk),
    spentTotalCzk: Number(row.spent_total_czk),
    spentTodayCzk: Number(row.spent_today_czk),
    targetCities: toStringArray(row.target_cities),
    targetCategories: toStringArray(row.target_categories),
    startsAt: toDate(row.starts_at),
    endsAt: toDateOrNull(row.ends_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function defaultNow(deps: ServiceDeps): Date {
  return deps.now ? deps.now() : new Date();
}

// ---------------------------------------------------------------------------
// Campaign lifecycle
// ---------------------------------------------------------------------------

export async function createCampaign(
  input: CampaignInput,
  deps: ServiceDeps,
): Promise<AdCampaign> {
  // Validace
  if (input.dailyBudgetCzk <= 0) {
    throw new PromotedAdsError('INVALID_BUDGET', 'dailyBudgetCzk must be > 0');
  }
  if (input.totalBudgetCzk < input.dailyBudgetCzk) {
    throw new PromotedAdsError(
      'INVALID_BUDGET',
      'totalBudgetCzk must be >= dailyBudgetCzk',
    );
  }
  if (input.maxCpcBidCzk <= 0) {
    throw new PromotedAdsError('INVALID_BID', 'maxCpcBidCzk must be > 0');
  }
  if (input.endsAt && input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw new PromotedAdsError(
      'INVALID_DATE_RANGE',
      'endsAt must be after startsAt',
    );
  }

  const now = defaultNow(deps);
  const id = randomUUID();
  const targetCities = input.targetCities ?? [];
  const targetCategories = input.targetCategories ?? [];

  await deps.db.execute(
    `INSERT INTO ad_campaigns (
      id, promoter_id, event_id, name, status, bid_strategy,
      max_cpc_bid_czk, daily_budget_czk, total_budget_czk,
      spent_total_czk, spent_today_czk,
      target_cities, target_categories,
      starts_at, ends_at, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, 'draft', $5,
      $6, $7, $8, 0, 0,
      $9, $10, $11, $12, $13, $13
    )`,
    [
      id,
      input.promoterId,
      input.eventId,
      input.name,
      input.bidStrategy,
      input.maxCpcBidCzk,
      input.dailyBudgetCzk,
      input.totalBudgetCzk,
      JSON.stringify(targetCities),
      JSON.stringify(targetCategories),
      input.startsAt,
      input.endsAt ?? null,
      now,
    ],
  );

  return {
    id,
    promoterId: input.promoterId,
    eventId: input.eventId,
    name: input.name,
    status: 'draft',
    bidStrategy: input.bidStrategy,
    maxCpcBidCzk: input.maxCpcBidCzk,
    dailyBudgetCzk: input.dailyBudgetCzk,
    totalBudgetCzk: input.totalBudgetCzk,
    spentTotalCzk: 0,
    spentTodayCzk: 0,
    targetCities,
    targetCategories,
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

async function loadCampaign(
  db: DbAdapter,
  campaignId: string,
): Promise<AdCampaign> {
  const rows = await db.query<CampaignRow>(
    `SELECT * FROM ad_campaigns WHERE id = $1`,
    [campaignId],
  );
  const row = rows[0];
  if (!row) {
    throw new PromotedAdsError(
      'CAMPAIGN_NOT_FOUND',
      `Campaign ${campaignId} not found`,
    );
  }
  return mapCampaign(row);
}

function assertOwnership(campaign: AdCampaign, promoterId: string): void {
  if (campaign.promoterId !== promoterId) {
    throw new PromotedAdsError(
      'CAMPAIGN_NOT_OWNED_BY_PROMOTER',
      `Campaign ${campaign.id} is not owned by promoter ${promoterId}`,
    );
  }
}

export async function activateCampaign(
  campaignId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<AdCampaign> {
  const campaign = await loadCampaign(deps.db, campaignId);
  assertOwnership(campaign, promoterId);

  if (campaign.status !== 'draft' && campaign.status !== 'paused') {
    throw new PromotedAdsError(
      'CAMPAIGN_NOT_ACTIVATABLE',
      `Campaign in status ${campaign.status} cannot be activated`,
    );
  }

  const now = defaultNow(deps);
  await deps.db.execute(
    `UPDATE ad_campaigns SET status = 'active', updated_at = $1 WHERE id = $2`,
    [now, campaignId],
  );

  return { ...campaign, status: 'active', updatedAt: now };
}

export async function pauseCampaign(
  campaignId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<AdCampaign> {
  const campaign = await loadCampaign(deps.db, campaignId);
  assertOwnership(campaign, promoterId);

  if (campaign.status !== 'active') {
    throw new PromotedAdsError(
      'CAMPAIGN_NOT_PAUSEABLE',
      `Campaign in status ${campaign.status} cannot be paused`,
    );
  }

  const now = defaultNow(deps);
  await deps.db.execute(
    `UPDATE ad_campaigns SET status = 'paused', updated_at = $1 WHERE id = $2`,
    [now, campaignId],
  );

  return { ...campaign, status: 'paused', updatedAt: now };
}

// ---------------------------------------------------------------------------
// Auction
// ---------------------------------------------------------------------------

export async function runAuction(
  context: AuctionContext,
  deps: ServiceDeps,
): Promise<AuctionWinner | null> {
  const now = defaultNow(deps);

  // Načti aktivní kampaně. Targeting filtrujeme v memory (jednodušší a flexibilní
  // pro JSON pole; pro škálu by šlo přepsat na SQL filter).
  const rows = await deps.db.query<CampaignRow>(
    `SELECT * FROM ad_campaigns WHERE status = 'active'`,
  );
  const campaigns = rows.map(mapCampaign);
  const eligible = filterEligibleCampaigns(campaigns, context, now);
  if (eligible.length === 0) return null;

  const candidates = eligible
    .map((c) => ({ campaign: c, effectiveBid: calculateEffectiveBid(c, now) }))
    .filter((c) => c.effectiveBid > 0);

  const result = runSecondPriceAuction(candidates);
  if (!result) return null;

  return {
    campaign: result.winner,
    cpcBidCzk: result.chargeAmountCzk,
  };
}

// ---------------------------------------------------------------------------
// Impression & Click tracking
// ---------------------------------------------------------------------------

export async function recordImpression(
  campaignId: string,
  context: AuctionContext,
  cpcBid: number,
  deps: ServiceDeps,
): Promise<AdImpression> {
  const now = defaultNow(deps);
  const id = randomUUID();

  await deps.db.execute(
    `INSERT INTO ad_impressions (
      id, campaign_id, user_id, placement, city, category,
      cpc_bid_czk, occurred_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      campaignId,
      context.userId,
      context.placement,
      context.city,
      context.category,
      cpcBid,
      now,
    ],
  );

  return {
    id,
    campaignId,
    userId: context.userId,
    placement: context.placement,
    city: context.city,
    category: context.category,
    cpcBidCzk: cpcBid,
    occurredAt: now,
  };
}

export async function recordClick(
  impressionId: string,
  deps: ServiceDeps,
): Promise<AdClick> {
  const now = defaultNow(deps);

  return deps.db.transaction(async (tx) => {
    // 1) Najdi impression
    const impressionRows = await tx.query<ImpressionRow>(
      `SELECT * FROM ad_impressions WHERE id = $1`,
      [impressionId],
    );
    const impression = impressionRows[0];
    if (!impression) {
      throw new PromotedAdsError(
        'IMPRESSION_NOT_FOUND',
        `Impression ${impressionId} not found`,
      );
    }

    // 2) Idempotency — click per impression
    const existingRows = await tx.query<ClickRow>(
      `SELECT * FROM ad_clicks WHERE impression_id = $1`,
      [impressionId],
    );
    if (existingRows.length > 0) {
      throw new PromotedAdsError(
        'CLICK_ALREADY_RECORDED',
        `Click for impression ${impressionId} already recorded`,
      );
    }

    const costCzk = Number(impression.cpc_bid_czk);
    const campaignId = impression.campaign_id;
    const clickId = randomUUID();

    // 3) Insert click
    await tx.execute(
      `INSERT INTO ad_clicks (
        id, campaign_id, impression_id, user_id, cost_czk, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [clickId, campaignId, impressionId, impression.user_id, costCzk, now],
    );

    // 4) Increment spent counters
    await tx.execute(
      `UPDATE ad_campaigns
       SET spent_total_czk = spent_total_czk + $1,
           spent_today_czk = spent_today_czk + $1,
           updated_at = $2
       WHERE id = $3`,
      [costCzk, now, campaignId],
    );

    // 5) Zkontroluj budget exhaustion
    const campaign = await loadCampaign(tx, campaignId);
    if (campaign.spentTotalCzk >= campaign.totalBudgetCzk) {
      await tx.execute(
        `UPDATE ad_campaigns SET status = 'budget_exhausted', updated_at = $1 WHERE id = $2`,
        [now, campaignId],
      );
    } else if (campaign.spentTodayCzk >= campaign.dailyBudgetCzk) {
      await tx.execute(
        `UPDATE ad_campaigns SET status = 'budget_exhausted', updated_at = $1 WHERE id = $2`,
        [now, campaignId],
      );
    }

    return {
      id: clickId,
      campaignId,
      impressionId,
      userId: impression.user_id,
      costCzk,
      occurredAt: now,
    };
  });
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export async function getCampaignMetrics(
  campaignId: string,
  deps: ServiceDeps,
): Promise<CampaignMetrics> {
  const campaign = await loadCampaign(deps.db, campaignId);

  const impressionRows = await deps.db.query<{ count: number | string }>(
    `SELECT COUNT(*) as count FROM ad_impressions WHERE campaign_id = $1`,
    [campaignId],
  );
  const clickRows = await deps.db.query<{ count: number | string }>(
    `SELECT COUNT(*) as count FROM ad_clicks WHERE campaign_id = $1`,
    [campaignId],
  );
  const conversionRows = await deps.db.query<{ count: number | string }>(
    `SELECT COUNT(*) as count FROM ad_conversions WHERE campaign_id = $1`,
    [campaignId],
  );

  const impressions = Number(impressionRows[0]?.count ?? 0);
  const clicks = Number(clickRows[0]?.count ?? 0);
  const conversions = Number(conversionRows[0]?.count ?? 0);

  const ctr = impressions > 0 ? clicks / impressions : 0;
  const conversionRate = clicks > 0 ? conversions / clicks : 0;
  const averageCpcCzk = clicks > 0 ? campaign.spentTotalCzk / clicks : 0;

  return {
    campaignId,
    impressions,
    clicks,
    ctr,
    conversions,
    conversionRate,
    spentTotalCzk: campaign.spentTotalCzk,
    averageCpcCzk,
  };
}

// ---------------------------------------------------------------------------
// Cron tasks
// ---------------------------------------------------------------------------

/**
 * Reset daily budgets — spouští se každou noc v 00:00.
 *
 * Kampaně, které byly 'budget_exhausted' kvůli dennímu budgetu (ale ještě
 * nedosáhly total budgetu), se vrátí na 'active'.
 */
export async function resetDailyBudgets(deps: ServiceDeps): Promise<void> {
  const now = defaultNow(deps);

  await deps.db.transaction(async (tx) => {
    // 1) Najdi kampaně, které budou reaktivovány (exhausted, ale total < budget)
    await tx.execute(
      `UPDATE ad_campaigns
       SET status = 'active', updated_at = $1
       WHERE status = 'budget_exhausted'
         AND spent_total_czk < total_budget_czk`,
      [now],
    );

    // 2) Resetuj denní spent counter pro všechny
    await tx.execute(
      `UPDATE ad_campaigns SET spent_today_czk = 0, updated_at = $1`,
      [now],
    );
  });
}

/**
 * Ukončí kampaně, kterým uplynul endsAt.
 */
export async function endExpiredCampaigns(deps: ServiceDeps): Promise<void> {
  const now = defaultNow(deps);
  await deps.db.execute(
    `UPDATE ad_campaigns
     SET status = 'ended', updated_at = $1
     WHERE status = 'active'
       AND ends_at IS NOT NULL
       AND ends_at <= $1`,
    [now],
  );
}
