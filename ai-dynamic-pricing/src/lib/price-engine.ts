/**
 * price-engine.ts — čisté funkce pro výpočet doporučené ceny.
 * Žádné IO, žádné side-effecty. Veškerá aritmetika v INTEGER haléřích.
 */

import type {
  DemandSignals,
  PricingRule,
  PriceRecommendation,
  PricingStrategy,
} from '../types/pricing.js';

// ─── Strategy implementations ────────────────────────────────────────────────

/**
 * Early bird: sleva pokud je prodáno méně než earlyBirdThresholdPct % kapacity.
 */
export function computeEarlyBird(
  signals: DemandSignals,
  rule: PricingRule,
): { price: number; reason: string | null } {
  if (signals.soldPercentage < rule.earlyBirdThresholdPct) {
    const price = Math.round(
      signals.basePriceHalire * (1 - rule.earlyBirdDiscountPct / 100),
    );
    return {
      price,
      reason: `Early bird sleva ${rule.earlyBirdDiscountPct}% (prodáno ${signals.soldPercentage.toFixed(1)}% < práh ${rule.earlyBirdThresholdPct}%)`,
    };
  }
  return { price: signals.basePriceHalire, reason: null };
}

/**
 * Demand curve: lineární interpolace mezi min a max cenou dle soldPercentage.
 * 0% sold = minPrice, 100% sold = maxPrice.
 */
export function computeDemandCurve(
  signals: DemandSignals,
  rule: PricingRule,
): { price: number; reason: string } {
  const ratio = Math.min(signals.soldPercentage / 100, 1);
  const price = Math.round(
    rule.minPriceHalire + ratio * (rule.maxPriceHalire - rule.minPriceHalire),
  );
  return {
    price,
    reason: `Poptávková křivka: ${signals.soldPercentage.toFixed(1)}% kapacity prodáno → interpolace`,
  };
}

/**
 * Time decay: cena roste lineárně jak se blíží datum eventu.
 * Od timeDecayStartDays do 0 dnů → 0% až timeDecayMaxIncreasePct nad base.
 */
export function computeTimeDecay(
  signals: DemandSignals,
  rule: PricingRule,
): { price: number; reason: string | null } {
  if (signals.daysUntilEvent >= rule.timeDecayStartDays) {
    return { price: signals.basePriceHalire, reason: null };
  }

  // How far along are we in the decay window? 0 = just started, 1 = event is now
  const progress = 1 - signals.daysUntilEvent / rule.timeDecayStartDays;
  const multiplier = 1 + (rule.timeDecayMaxIncreasePct / 100) * progress;
  const price = Math.round(signals.basePriceHalire * multiplier);

  return {
    price,
    reason: `Časový nárůst: ${signals.daysUntilEvent.toFixed(0)} dní do akce → +${(rule.timeDecayMaxIncreasePct * progress).toFixed(1)}%`,
  };
}

/**
 * Surge: pokud salesLast1h překročí práh, aplikuje se násobek na aktuální cenu.
 */
export function computeSurge(
  signals: DemandSignals,
  rule: PricingRule,
): { price: number; reason: string | null } {
  if (signals.salesLast1h > rule.surgeVelocityThreshold) {
    const price = Math.round(signals.currentPriceHalire * rule.surgeMultiplier);
    return {
      price,
      reason: `Surge: ${signals.salesLast1h} prodejů/h > práh ${rule.surgeVelocityThreshold} → ×${rule.surgeMultiplier}`,
    };
  }
  return { price: signals.currentPriceHalire, reason: null };
}

// ─── Clamp helper ────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ─── Main compute function ───────────────────────────────────────────────────

export function computeRecommendedPrice(
  signals: DemandSignals,
  rule: PricingRule,
): PriceRecommendation {
  const reasons: string[] = [];
  let recommendedPrice: number;
  let strategy: PricingStrategy = rule.strategy;

  if (rule.strategy === 'static') {
    // Static — beze změny
    recommendedPrice = signals.currentPriceHalire;
    reasons.push('Statická strategie — cena se nemění.');
  } else if (rule.strategy === 'early_bird') {
    const eb = computeEarlyBird(signals, rule);
    recommendedPrice = eb.price;
    if (eb.reason) reasons.push(eb.reason);
  } else if (rule.strategy === 'time_decay') {
    const td = computeTimeDecay(signals, rule);
    recommendedPrice = td.price;
    if (td.reason) reasons.push(td.reason);
  } else if (rule.strategy === 'surge') {
    const sg = computeSurge(signals, rule);
    recommendedPrice = sg.price;
    if (sg.reason) reasons.push(sg.reason);
  } else {
    // demand_curve (default combined) — pick the highest price signal
    const eb = computeEarlyBird(signals, rule);
    const dc = computeDemandCurve(signals, rule);
    const td = computeTimeDecay(signals, rule);
    const sg = computeSurge(signals, rule);

    // Collect all candidate prices with their reasons
    const candidates: { price: number; reason: string | null; strat: PricingStrategy }[] = [
      { price: eb.price, reason: eb.reason, strat: 'early_bird' },
      { price: dc.price, reason: dc.reason, strat: 'demand_curve' },
      { price: td.price, reason: td.reason, strat: 'time_decay' },
      { price: sg.price, reason: sg.reason, strat: 'surge' },
    ];

    // Pick the max price (highest signal wins)
    let best = candidates[0];
    for (const c of candidates) {
      if (c.price > best.price) {
        best = c;
      }
    }

    recommendedPrice = best.price;
    strategy = best.strat;

    // Add all active reasons for transparency
    for (const c of candidates) {
      if (c.reason) reasons.push(c.reason);
    }
  }

  // Clamp to [min, max]
  recommendedPrice = clamp(recommendedPrice, rule.minPriceHalire, rule.maxPriceHalire);

  // Ensure integer
  recommendedPrice = Math.round(recommendedPrice);

  const deltaHalire = recommendedPrice - signals.currentPriceHalire;
  const deltaPct =
    signals.currentPriceHalire > 0
      ? (deltaHalire / signals.currentPriceHalire) * 100
      : 0;

  // Confidence heuristic: higher when more data is available
  let confidence = 50;
  if (signals.salesLast7d >= 10) confidence += 15;
  if (signals.salesLast24h >= 3) confidence += 10;
  if (signals.soldPercentage > 5) confidence += 10;
  if (signals.daysUntilEvent < 30) confidence += 5;
  if (signals.totalCapacity > 0) confidence += 10;
  confidence = Math.min(confidence, 100);

  // Auto-apply only if delta is small (< 15%) and confidence is high (> 70)
  const absDeltaPct = Math.abs(deltaPct);
  const shouldAutoApply = absDeltaPct < 15 && confidence > 70;

  return {
    ticketTypeId: signals.ticketTypeId,
    currentPriceHalire: signals.currentPriceHalire,
    recommendedPriceHalire: recommendedPrice,
    deltaHalire,
    deltaPct: Math.round(deltaPct * 100) / 100,
    strategy,
    reasons,
    confidence,
    shouldAutoApply,
  };
}
