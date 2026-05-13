export interface FeeSchedule {
  id: string;
  promoterId: string;
  name: string;
  percentageFee: number;   // celé číslo: 500 = 5.00 %
  fixedFee: number;        // haléře
  minFee: number | null;   // haléře
  maxFee: number | null;   // haléře
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface FeeCalculation {
  ticketPrice: number;       // haléře — vstupní cena vstupenky
  percentageAmount: number;  // haléře — % část poplatku
  fixedAmount: number;       // haléře — fixní část
  rawFee: number;            // haléře — percentage + fixed před clampem
  platformFee: number;       // haléře — výsledný poplatek (po min/max)
  promoterAmount: number;    // haléře — ticketPrice - platformFee
  feeScheduleId: string;
  appliedPercentage: number; // 500 = 5.00 %
}

export interface OrderFeeResult {
  lineItems: FeeCalculation[];    // per ticket/item
  totalPlatformFee: number;       // haléře — součet platformFee všech items
  totalPromoterPayout: number;    // haléře — součet promoterAmount všech items
  totalGrossRevenue: number;      // haléře — součet ticketPrice všech items
  feeScheduleId: string;
}

export interface RevenueSummaryRow {
  day: string;
  promoterId: string;
  orderCount: number;
  grossRevenue: number;
  platformFees: number;
  promoterPayouts: number;
  currency: string;
}

// ---------------------------------------------------------------------------
// Promoter tier system
// ---------------------------------------------------------------------------

export type PromoterTier = 'starter' | 'growth' | 'pro' | 'enterprise';

export interface PromoterTierAssignment {
  promoterId: string;
  tier: PromoterTier;
  assignedAt: string;
  assignedBy: string | null;   // null = auto-assigned
  validUntil: string | null;
}

export const TIER_DEFAULT_FEE_SCHEDULES: Record<PromoterTier, {
  percentageFee: number;   // halíře, stored as integer basis points ×10 (e.g. 1000 = 10%)
  fixedFee: number;        // INTEGER halíře per ticket
  minFee: number | null;
  maxFee: number | null;
  name: string;
}> = {
  starter:    { percentageFee: 1200, fixedFee: 500, minFee: 200, maxFee: null, name: 'Starter — 12% + 5 Kč' },
  growth:     { percentageFee: 900,  fixedFee: 400, minFee: 150, maxFee: null, name: 'Growth — 9% + 4 Kč' },
  pro:        { percentageFee: 700,  fixedFee: 300, minFee: 100, maxFee: null, name: 'Pro — 7% + 3 Kč' },
  enterprise: { percentageFee: 500,  fixedFee: 200, minFee: 50,  maxFee: null, name: 'Enterprise — 5% + 2 Kč' },
};

// ---------------------------------------------------------------------------
// Fee schedule audit log
// ---------------------------------------------------------------------------

export interface FeeAuditEntry {
  id: string;
  promoterId: string;
  scheduleId: string | null;
  action: 'created' | 'updated' | 'deactivated' | 'tier_assigned';
  adminUserId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}
