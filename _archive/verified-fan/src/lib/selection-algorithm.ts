// Weighted fan selection algorithm for Verified Fan presale.
//
// Scoring rules (see feature #51):
//   - loyaltyYears * 10            (cap 50)
//   - pastPurchases * 5            (cap 50)
//   - identityVerified ? +30 : 0
//   - localFan ? +15 : 0
//   - socialFollowers / 1000       (cap 20)
//   - early registration bonus: max +10 for first 24h after presale opened
//
// Use `.js` extensions for intra-package relative imports (NodeNext).

export interface FanWeightInputs {
  fanId: string;
  /** Years as registered customer. */
  loyaltyYears: number;
  /** Number of past tickets purchased from same artist/promoter. */
  pastPurchases: number;
  /** Identity verified via BankID? */
  identityVerified: boolean;
  /** Local to event city? */
  localFan: boolean;
  /** Social media followers count (from screening). */
  socialFollowers: number;
  /** Pre-registration timestamp — earlier registrants get small bonus. */
  registeredAt: Date;
}

export interface FanWeight {
  fanId: string;
  totalScore: number;
  breakdown: Record<string, number>;
}

/**
 * Compute a weighted score for a single fan.
 *
 * `eventStart` here is used as the reference "presale opened at" marker —
 * we give bonus points to anyone who registered in the first 24h window.
 */
export function computeFanWeight(input: FanWeightInputs, eventStart: Date): FanWeight {
  const loyalty = Math.min(50, Math.max(0, input.loyaltyYears) * 10);
  const purchases = Math.min(50, Math.max(0, input.pastPurchases) * 5);
  const identity = input.identityVerified ? 30 : 0;
  const local = input.localFan ? 15 : 0;
  const social = Math.min(20, Math.max(0, input.socialFollowers) / 1000);

  // Early registration bonus: linear decay from +10 at t=0h to 0 at t=24h.
  const hoursSinceOpen =
    (input.registeredAt.getTime() - eventStart.getTime()) / (60 * 60 * 1000);
  let early = 0;
  if (hoursSinceOpen >= 0 && hoursSinceOpen <= 24) {
    early = 10 * (1 - hoursSinceOpen / 24);
  }

  const breakdown = {
    loyalty,
    purchases,
    identity,
    local,
    social,
    early,
  };

  const totalScore = loyalty + purchases + identity + local + social + early;

  return { fanId: input.fanId, totalScore, breakdown };
}

/**
 * Select top N fans by weighted score.
 * Ties are broken with a small deterministic-ish randomness so repeated
 * runs don't always favor the same fan — but the ordering is stable
 * within a single call.
 */
export function selectFans(weights: FanWeight[], targetCount: number): FanWeight[] {
  if (targetCount <= 0) return [];

  // Sort desc by score; for ties add a tiny random tiebreaker.
  const sorted = [...weights].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return Math.random() - 0.5;
  });

  return sorted.slice(0, targetCount);
}
