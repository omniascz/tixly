/**
 * Promoter tier rules — 4 tiers, automatický upgrade na základě objemu.
 *
 * Tier 1 (nový):        manual approve, 500 tix/event, 8% fee
 * Tier 2 (ověřený):     auto-approve, 5000 tix/event, 7% fee
 * Tier 3 (premium):     auto-approve, unlimited, 6% fee
 * Tier 4 (enterprise):  custom SLA, 5% fee (Super Admin nastavuje ručně)
 *
 * Auto-upgrade thresholds (objem za posledních 90 dní):
 *   Tier 1 → 2: ≥ 1000 prodaných lístků a kyc_status='verified'
 *   Tier 2 → 3: ≥ 20000 prodaných lístků
 *   Tier 3 → 4: jen ručně Super Adminem (enterprise smlouva)
 *
 * Auto-downgrade se neprovádí (tier je sticky).
 */

export type PromoterTier = 1 | 2 | 3 | 4;

export interface TierRules {
  tier: PromoterTier;
  autoApprove: boolean;
  maxTicketsPerEvent: number | null; // null = unlimited
  platformFeePct: number;
  label: string;
}

export const TIER_RULES: Record<PromoterTier, TierRules> = {
  1: { tier: 1, autoApprove: false, maxTicketsPerEvent: 500, platformFeePct: 8, label: 'Nový' },
  2: { tier: 2, autoApprove: true, maxTicketsPerEvent: 5000, platformFeePct: 7, label: 'Ověřený' },
  3: { tier: 3, autoApprove: true, maxTicketsPerEvent: null, platformFeePct: 6, label: 'Premium' },
  4: { tier: 4, autoApprove: true, maxTicketsPerEvent: null, platformFeePct: 5, label: 'Enterprise' },
};

export function rulesForTier(tier: number): TierRules {
  const t = Math.max(1, Math.min(4, tier)) as PromoterTier;
  return TIER_RULES[t];
}

export interface TierEvaluation {
  currentTier: PromoterTier;
  suggestedTier: PromoterTier;
  totalTicketsSold90d: number;
  reason: string;
}

export function evaluateTierUpgrade(input: {
  currentTier: PromoterTier;
  ticketsSold90d: number;
  kycVerified: boolean;
  tierLocked: boolean;
}): TierEvaluation {
  if (input.tierLocked) {
    return {
      currentTier: input.currentTier,
      suggestedTier: input.currentTier,
      totalTicketsSold90d: input.ticketsSold90d,
      reason: 'tier_locked',
    };
  }

  let suggested = input.currentTier;
  let reason = 'no_change';

  if (input.currentTier === 1 && input.ticketsSold90d >= 1000 && input.kycVerified) {
    suggested = 2;
    reason = 'upgrade_to_verified';
  } else if (input.currentTier === 2 && input.ticketsSold90d >= 20000) {
    suggested = 3;
    reason = 'upgrade_to_premium';
  }

  return {
    currentTier: input.currentTier,
    suggestedTier: suggested,
    totalTicketsSold90d: input.ticketsSold90d,
    reason,
  };
}
