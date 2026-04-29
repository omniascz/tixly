import type { PricingPhase, PricingRule } from '../types/pricing';

/**
 * Calculates demand factor based on sold percentage.
 * Linear interpolation between demandFactorMin and demandFactorMax,
 * clamped to [demandFactorMin, demandFactorMax], rounded to 2 decimal places.
 */
export function calculateDemandFactor(
  soldQty: number,
  totalQty: number,
  rule: PricingRule,
): number {
  if (totalQty <= 0) {
    return rule.demandFactorMin;
  }

  const soldPercent = Math.max(0, Math.min(1, soldQty / totalQty));
  const rawFactor =
    rule.demandFactorMin +
    (rule.demandFactorMax - rule.demandFactorMin) * soldPercent;

  const clamped = Math.max(
    rule.demandFactorMin,
    Math.min(rule.demandFactorMax, rawFactor),
  );

  return Math.round(clamped * 100) / 100;
}

/**
 * Calculates final price by applying demand factor and rounding up to nearest 10 Kč.
 * Psychological pricing: 44000 instead of 43700 (prices are in haléře, 1000 haléřů = 10 Kč).
 */
export function calculateFinalPrice(
  phasePrice: number,
  demandFactor: number,
): number {
  return Math.ceil((phasePrice * demandFactor) / 1000) * 1000;
}

/**
 * Resolves the currently active pricing rule for given ticket type state.
 * A rule is active when:
 *   - active = true
 *   - threshold_date <= now OR threshold_qty <= soldQty (either condition)
 * Returns the rule with highest priority among matching rules.
 */
export function resolveActivePhase(
  rules: PricingRule[],
  soldQty: number,
  totalQty: number,
  now: Date,
): PricingRule | null {
  const activeRules = rules.filter((rule) => {
    if (!rule.active) return false;

    const dateTriggered =
      rule.thresholdDate !== null && rule.thresholdDate <= now;
    const qtyTriggered =
      rule.thresholdQty !== null && soldQty >= rule.thresholdQty;

    // A rule with no thresholds at all cannot trigger
    if (rule.thresholdDate === null && rule.thresholdQty === null) {
      return false;
    }

    return dateTriggered || qtyTriggered;
  });

  if (activeRules.length === 0) return null;

  // Sort by priority descending — highest priority wins (most recent phase)
  activeRules.sort((a, b) => b.priority - a.priority);
  return activeRules[0] ?? null;
}

/**
 * Finds the next phase that has not yet been triggered.
 * Returns the nearest upcoming phase — the one that will trigger first,
 * judged by the minimum of (time to date threshold, qty remaining to qty threshold).
 *
 * When both date and qty thresholds exist on the same rule, both are returned
 * so the UI can display whichever is most informative.
 */
export function getNextPhase(
  rules: PricingRule[],
  currentPhase: PricingPhase,
  soldQty: number,
  totalQty: number,
  now: Date,
): { phase: PricingPhase; date?: Date; qty?: number } | null {
  void totalQty; // available for future use (e.g. % remaining)

  // Keep only rules that are active, not the current phase, and not yet triggered
  const pendingRules = rules.filter((rule) => {
    if (!rule.active || rule.phase === currentPhase) return false;
    if (rule.thresholdDate === null && rule.thresholdQty === null) return false;

    const dateTriggered =
      rule.thresholdDate !== null && rule.thresholdDate <= now;
    const qtyTriggered =
      rule.thresholdQty !== null && soldQty >= rule.thresholdQty;

    // A rule is still pending only if ALL of its thresholds are untriggered
    if (rule.thresholdDate !== null && rule.thresholdQty !== null) {
      return !dateTriggered && !qtyTriggered;
    }
    if (rule.thresholdDate !== null) return !dateTriggered;
    return !qtyTriggered;
  });

  if (pendingRules.length === 0) return null;

  // Score each pending rule: how soon will it trigger?
  // Use milliseconds-to-date-threshold and qty-remaining as separate dimensions.
  // Pick the rule with the smallest "nearest trigger" value.
  const scored = pendingRules.map((rule) => {
    const msToDate =
      rule.thresholdDate !== null
        ? rule.thresholdDate.getTime() - now.getTime()
        : Infinity;
    const qtyToGo =
      rule.thresholdQty !== null ? rule.thresholdQty - soldQty : Infinity;

    // Convert qty-remaining to a comparable score by treating each unsold
    // ticket as an abstract unit. We compare msToDate vs qtyToGo independently
    // and take whichever is lower (i.e. which threshold is "closer").
    // Because units differ (ms vs tickets), we simply pick the rule whose
    // minimum score across both dimensions is smallest.
    const score = Math.min(msToDate, qtyToGo === Infinity ? Infinity : qtyToGo * 1e9);
    return { rule, msToDate, qtyToGo, score };
  });

  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  if (best === undefined) return null;

  const result: { phase: PricingPhase; date?: Date; qty?: number } = {
    phase: best.rule.phase,
  };
  if (best.rule.thresholdDate !== null) result.date = best.rule.thresholdDate;
  if (best.rule.thresholdQty !== null) result.qty = best.rule.thresholdQty;

  return result;
}
