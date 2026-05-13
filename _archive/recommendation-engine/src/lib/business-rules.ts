/**
 * business-rules.ts — Post-scoring hard constraints applied to recommendation
 * candidates before returning results to the user.
 *
 * Rules are applied in strict order:
 *   1. Filter sold-out events
 *   2. Filter past events
 *   3. Filter already-purchased events
 *   4. Enforce category diversity (max N per category in top M)
 *   5. Boost events from organizers where user has an active season pass
 */

import { BusinessRulesContext, RankedCandidate } from "../types/recommendation.types";
import { ExplanationKey } from "../types/recommendation.types";

// ─── Individual rule functions ────────────────────────────────────────────────

/** Rule 1: Remove sold-out events (sell_through_rate >= 1.0). */
function filterSoldOut(candidates: RankedCandidate[]): RankedCandidate[] {
  return candidates.filter(
    (c) => c.eventFeatures.sellThroughRate < 1.0,
  );
}

/** Rule 2: Remove events that have already started or passed. */
function filterPastEvents(candidates: RankedCandidate[]): RankedCandidate[] {
  return candidates.filter(
    (c) => c.eventFeatures.daysUntilEvent >= 0,
  );
}

/** Rule 3: Remove events the user has already purchased a ticket for. */
function filterPurchased(
  candidates: RankedCandidate[],
  purchasedEventIds: Set<string>,
): RankedCandidate[] {
  return candidates.filter(
    (c) => !purchasedEventIds.has(c.eventFeatures.eventId),
  );
}

/**
 * Rule 4: Enforce category diversity in the top N results.
 *
 * Algorithm:
 *   - Walk through candidates in current score order.
 *   - Track how many times each category appears in the top-N window.
 *   - If a category already has `maxPerCategory` entries in that window,
 *     defer the candidate to the "overflow" list which is appended after.
 *
 * This preserves relative ordering within each category and ensures the
 * top-N slice is diverse, while not losing candidates from the final list.
 */
function enforceDiversity(
  candidates: RankedCandidate[],
  maxPerCategory: number,
  topN: number,
): RankedCandidate[] {
  const categoryCounts = new Map<string, number>();
  const primary: RankedCandidate[] = [];
  const overflow: RankedCandidate[] = [];

  for (const candidate of candidates) {
    const cat = candidate.eventFeatures.category;
    const count = categoryCounts.get(cat) ?? 0;

    if (primary.length < topN && count < maxPerCategory) {
      categoryCounts.set(cat, count + 1);
      primary.push(candidate);
    } else {
      overflow.push(candidate);
    }
  }

  // Overflow items receive ranks starting at topN+1 so they fall outside the
  // top-N window that diversity rules apply to.
  return [
    ...primary.map((c, i) => ({ ...c, rank: i + 1 })),
    ...overflow.map((c, i) => ({ ...c, rank: topN + 1 + i })),
  ];
}

/**
 * Rule 5: Boost events from organizers where the user holds an active season
 * pass (score × 1.3). Re-sort after boosting.
 *
 * The explanation key is updated to reflect the organizer pass benefit.
 */
function applySeasonPassBoost(
  candidates: RankedCandidate[],
  activePassOrganizerIds: string[],
): RankedCandidate[] {
  if (activePassOrganizerIds.length === 0) return candidates;

  const pasSet = new Set(activePassOrganizerIds);

  const boosted = candidates.map((c) => {
    if (!pasSet.has(c.eventFeatures.organizerId)) return c;

    return {
      ...c,
      finalScore: Math.min(1, c.finalScore * 1.3),
      explanationKey: ExplanationKey.OrganizerPass,
      explanationParams: { organizerName: c.eventFeatures.organizerName },
    };
  });

  // Re-sort by finalScore descending after boost
  boosted.sort((a, b) => b.finalScore - a.finalScore);

  return boosted;
}

/** Re-assigns rank numbers 1..N after filtering/reordering. */
function reassignRanks(candidates: RankedCandidate[]): RankedCandidate[] {
  return candidates.map((c, idx) => ({ ...c, rank: idx + 1 }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Applies all five business rules in the specified order and returns
 * filtered, re-ranked candidates.
 *
 * Callers should pass candidates pre-sorted by descending finalScore.
 */
export function applyBusinessRules(
  candidates: RankedCandidate[],
  context: BusinessRulesContext,
): RankedCandidate[] {
  let result = candidates;

  // 1. Sold-out
  result = filterSoldOut(result);

  // 2. Past events
  result = filterPastEvents(result);

  // 3. Already purchased
  result = filterPurchased(result, context.purchasedEventIds);

  // 4. Season pass boost (before diversity so boosts affect diversity window)
  result = applySeasonPassBoost(result, context.activePassOrganizerIds);

  // 5. Category diversity — also handles rank assignment (overflow gets rank > topN)
  result = enforceDiversity(
    result,
    context.diversityMaxPerCategory,
    context.diversityTopN,
  );

  return result;
}
