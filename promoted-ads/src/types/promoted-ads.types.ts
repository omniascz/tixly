// =============================================================================
// Promoted Ads — Types (Feature #52)
//
// CPC (cost-per-click) reklamní platforma na Tixly marketplace.
// Promotéři vytvářejí kampaně → auction-based výběr vítěze → billing za kliky.
// =============================================================================

export type CampaignStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'budget_exhausted'
  | 'ended'
  | 'rejected';

export type BidStrategy = 'manual_cpc' | 'auto_cpc';

export type AdEventType = 'impression' | 'click' | 'conversion';

export interface AdCampaign {
  id: string;
  promoterId: string;
  eventId: string; // promovaná akce
  name: string;
  status: CampaignStatus;
  bidStrategy: BidStrategy;
  maxCpcBidCzk: number; // max nabídka v haléřích na 1 klik
  dailyBudgetCzk: number; // denní budget v haléřích
  totalBudgetCzk: number; // celkový budget v haléřích
  spentTotalCzk: number; // dosud utraceno
  spentTodayCzk: number; // dnes utraceno
  targetCities: string[]; // ['Praha', 'Brno'] — empty = all
  targetCategories: string[]; // ['concert', 'theater'] — empty = all
  startsAt: Date;
  endsAt: Date | null; // null = run forever
  createdAt: Date;
  updatedAt: Date;
}

export interface AdImpression {
  id: string;
  campaignId: string;
  userId: string | null; // null pro anonymní
  placement: string; // 'home_feed', 'search_results', 'event_detail_sidebar'
  city: string | null;
  category: string | null;
  cpcBidCzk: number; // bid v okamžiku zobrazení
  occurredAt: Date;
}

export interface AdClick {
  id: string;
  campaignId: string;
  impressionId: string;
  userId: string | null;
  costCzk: number; // skutečná cena (second-price auction)
  occurredAt: Date;
}

export interface CampaignMetrics {
  campaignId: string;
  impressions: number;
  clicks: number;
  ctr: number; // clicks / impressions
  conversions: number; // tracked separately
  conversionRate: number;
  spentTotalCzk: number;
  averageCpcCzk: number;
}

export interface AuctionContext {
  placement: string;
  city: string | null;
  category: string | null;
  userId: string | null;
}

export interface AuctionWinner {
  campaign: AdCampaign;
  cpcBidCzk: number; // skutečná účtovaná částka
}

export interface CampaignInput {
  promoterId: string;
  eventId: string;
  name: string;
  bidStrategy: BidStrategy;
  maxCpcBidCzk: number;
  dailyBudgetCzk: number;
  totalBudgetCzk: number;
  targetCities?: string[];
  targetCategories?: string[];
  startsAt: Date;
  endsAt?: Date;
}

export class PromotedAdsError extends Error {
  constructor(
    public readonly code:
      | 'CAMPAIGN_NOT_FOUND'
      | 'CAMPAIGN_NOT_OWNED_BY_PROMOTER'
      | 'INVALID_BUDGET'
      | 'INVALID_BID'
      | 'INVALID_DATE_RANGE'
      | 'CAMPAIGN_NOT_PAUSEABLE'
      | 'CAMPAIGN_NOT_ACTIVATABLE'
      | 'IMPRESSION_NOT_FOUND'
      | 'CLICK_ALREADY_RECORDED',
    message: string,
  ) {
    super(message);
    this.name = 'PromotedAdsError';
  }
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

export interface ServiceDeps {
  db: DbAdapter;
  now?: () => Date; // injectable pro testy
}
