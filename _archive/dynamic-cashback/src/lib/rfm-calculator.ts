// rfm-calculator.ts — čisté funkce pro RFM skóring a kohortu.
// Žádné side-effecty, snadno testovatelné.

import type { RfmScore } from '../types/dynamic-cashback.js';

export interface RfmInputs {
  /** Days since last purchase */
  recencyDays: number;
  /** Total order count in last 12 months */
  frequency12m: number;
  /** Total spend in halíře in last 12 months */
  monetaryHalire12m: number;
}

type Score = 1 | 2 | 3 | 4 | 5;

function scoreRecency(days: number): Score {
  if (days <= 7) return 5;
  if (days <= 30) return 4;
  if (days <= 90) return 3;
  if (days <= 180) return 2;
  return 1;
}

function scoreFrequency(count: number): Score {
  if (count >= 10) return 5;
  if (count >= 5) return 4;
  if (count >= 3) return 3;
  if (count >= 2) return 2;
  return 1;
}

function scoreMonetary(halire: number): Score {
  if (halire >= 1_000_000) return 5;
  if (halire >= 500_000) return 4;
  if (halire >= 200_000) return 3;
  if (halire >= 100_000) return 2;
  return 1;
}

/**
 * Urči kohortu z R/F/M skóre dle standardních CRM pravidel.
 * Pořadí testů je významné — přednost mají specifičtější kohorty.
 */
export function determineCohort(score: {
  recency: number;
  frequency: number;
  monetary: number;
}): RfmScore['cohort'] {
  const { recency: r, frequency: f, monetary: m } = score;

  // champion: R=4-5, F=4-5, M=4-5
  if (r >= 4 && f >= 4 && m >= 4) return 'champion';

  // at_risk: R=2-3, F=4-5, M=4-5 (dříve skvělý, teď se vzdaluje)
  if (r >= 2 && r <= 3 && f >= 4 && m >= 4) return 'at_risk';

  // loyal: F=4-5 (a nespadá do champion/at_risk výše)
  if (f >= 4) return 'loyal';

  // new: R=4-5, F=1
  if (r >= 4 && f === 1) return 'new';

  // potential: R=4-5, F=2-3, M=2-3
  if (r >= 4 && f >= 2 && f <= 3 && m >= 2 && m <= 3) return 'potential';

  // hibernating: R=1-2, F=2-3
  if (r <= 2 && f >= 2 && f <= 3) return 'hibernating';

  // lost: R=1, F=1-2
  if (r === 1 && f <= 2) return 'lost';

  // Fallback: dle recency
  if (r >= 4) return 'potential';
  if (r <= 1) return 'lost';
  return 'hibernating';
}

export function scoreRfm(inputs: RfmInputs): RfmScore {
  const recency = scoreRecency(inputs.recencyDays);
  const frequency = scoreFrequency(inputs.frequency12m);
  const monetary = scoreMonetary(inputs.monetaryHalire12m);
  const cohort = determineCohort({ recency, frequency, monetary });
  return { recency, frequency, monetary, cohort };
}
