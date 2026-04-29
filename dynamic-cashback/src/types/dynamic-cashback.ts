// dynamic-cashback.ts — typy pro modul Dynamic Cashback & Loyalty 2.0.

export interface RfmScore {
  recency: 1 | 2 | 3 | 4 | 5;
  frequency: 1 | 2 | 3 | 4 | 5;
  monetary: 1 | 2 | 3 | 4 | 5;
  /** Computed RFM cohort */
  cohort:
    | 'champion'
    | 'loyal'
    | 'potential'
    | 'at_risk'
    | 'hibernating'
    | 'lost'
    | 'new';
}

export interface CashbackComponents {
  tierBps: number;
  rfmBps: number;
  segmentBps: number;
  eventBoostBps: number;
  /** Cap applied value (null = nebyl potřeba cap) */
  cappedAt: number | null;
}

export interface PersonalizedCashback {
  userId: string;
  promoterId: string;
  /** Final effective rate in basis points (1000 = 10%) */
  effectiveRateBps: number;
  components: CashbackComponents;
  reasons: string[];
  computedAt: Date;
  validUntil: Date;
}

export interface CashbackConfig {
  /** Per-promoter max rate (0..2000 bps) */
  maxRateBps: number;
  tierBps: {
    bronze: number;
    silver: number;
    gold: number;
    platinum: number;
  };
  rfmCohortBps: Record<RfmScore['cohort'], number>;
  segmentBps: Record<string, number>;
  defaultEventBoostBps: number;
  cacheTtlSeconds: number;
}

export const DEFAULT_CASHBACK_CONFIG: CashbackConfig = {
  maxRateBps: 2000,
  tierBps: { bronze: 100, silver: 200, gold: 400, platinum: 800 },
  rfmCohortBps: {
    champion: 500,
    loyal: 300,
    potential: 200,
    new: 100,
    at_risk: 200,
    hibernating: 300,
    lost: 0,
  },
  segmentBps: {},
  defaultEventBoostBps: 0,
  cacheTtlSeconds: 3600,
};

export interface ApplyCashbackInput {
  userId: string;
  promoterId: string;
  orderId: string;
  orderAmountHalire: number;
  eventId?: string;
}

export interface CashbackResult {
  cashbackHalire: number;
  rate: PersonalizedCashback;
  ledgerEntryId: string;
}
