// rate-calculator.ts — čistá funkce pro skládání cashback sazby.

import type {
  CashbackComponents,
  CashbackConfig,
  RfmScore,
} from '../types/dynamic-cashback.js';

type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';

/** Horní mez pro součet segmentových bonusů (anti-stacking). */
const SEGMENT_STACK_CAP_BPS = 800;

export function computePersonalizedRate(
  tier: Tier,
  rfm: RfmScore,
  segmentMemberships: string[],
  eventBoostBps: number,
  config: CashbackConfig,
): {
  effectiveRateBps: number;
  components: CashbackComponents;
  reasons: string[];
} {
  const tierBps = config.tierBps[tier];
  const rfmBps = config.rfmCohortBps[rfm.cohort] ?? 0;

  const segmentRaw = segmentMemberships.reduce(
    (sum, segId) => sum + (config.segmentBps[segId] ?? 0),
    0,
  );
  const segmentBps = Math.min(segmentRaw, SEGMENT_STACK_CAP_BPS);

  const effectiveEventBoost =
    eventBoostBps > 0 ? eventBoostBps : config.defaultEventBoostBps;

  const raw = tierBps + rfmBps + segmentBps + effectiveEventBoost;
  const effectiveRateBps = Math.min(raw, config.maxRateBps);
  const cappedAt = raw > config.maxRateBps ? config.maxRateBps : null;

  const components: CashbackComponents = {
    tierBps,
    rfmBps,
    segmentBps,
    eventBoostBps: effectiveEventBoost,
    cappedAt,
  };

  const reasons: string[] = [
    `Tier ${tier}: +${tierBps}bps`,
    `RFM ${rfm.cohort} (R${rfm.recency}F${rfm.frequency}M${rfm.monetary}): +${rfmBps}bps`,
    `Segmenty (${segmentMemberships.length}): +${segmentBps}bps${
      segmentRaw > SEGMENT_STACK_CAP_BPS
        ? ` (oříznuto z ${segmentRaw}bps)`
        : ''
    }`,
    `Event boost: +${effectiveEventBoost}bps`,
  ];
  if (cappedAt !== null) {
    reasons.push(
      `Cap promotéra: oříznuto z ${raw}bps na ${cappedAt}bps (max ${config.maxRateBps}bps)`,
    );
  }

  return { effectiveRateBps, components, reasons };
}
