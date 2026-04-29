import type {
  AttributionModel,
  AttributionResult,
  TouchPoint,
} from '../types/attribution.types';

// ---------------------------------------------------------------------------
// calculateAttribution
// ---------------------------------------------------------------------------

/**
 * Assigns credit to each touch point according to the chosen attribution model.
 *
 * Rules:
 *   first_click — 100 % credit to the earliest touch point (lowest createdAt)
 *   last_click  — 100 % credit to the most recent touch point (highest createdAt)
 *   linear      — credit distributed equally (1/n per touch point), rounded to
 *                 4 decimal places; the LAST touch point absorbs any floating-
 *                 point residual so that the sum is exactly 1.0
 *
 * Returns an empty array when `touchPoints` is empty.
 * The input array is NOT mutated; a defensive copy is sorted internally.
 */
export function calculateAttribution(
  touchPoints: TouchPoint[],
  model: AttributionModel,
): AttributionResult[] {
  if (touchPoints.length === 0) {
    return [];
  }

  // Sort chronologically (earliest first) — stable, non-mutating
  const sorted = [...touchPoints].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  switch (model) {
    case 'first_click': {
      const first = sorted[0]!;
      return [{ touchPointId: first.id, channel: first.channel, credit: 1 }];
    }

    case 'last_click': {
      const last = sorted[sorted.length - 1]!;
      return [{ touchPointId: last.id, channel: last.channel, credit: 1 }];
    }

    case 'linear': {
      return distributeLinear(sorted);
    }
  }
}

// ---------------------------------------------------------------------------
// Linear distribution helper
// ---------------------------------------------------------------------------

const DECIMAL_PLACES = 4;
const ROUNDING_FACTOR = Math.pow(10, DECIMAL_PLACES);

function round4(value: number): number {
  return Math.round(value * ROUNDING_FACTOR) / ROUNDING_FACTOR;
}

function distributeLinear(sorted: TouchPoint[]): AttributionResult[] {
  const n = sorted.length;
  const unitCredit = round4(1 / n);

  const results: AttributionResult[] = sorted.map((tp) => ({
    touchPointId: tp.id,
    channel: tp.channel,
    credit: unitCredit,
  }));

  // Recalculate the last entry's credit as the remainder so that the total is
  // always exactly 1.0 regardless of floating-point rounding.
  const sumExceptLast = results
    .slice(0, n - 1)
    .reduce((acc, r) => acc + r.credit, 0);

  // round4 applied to the remainder keeps consistent precision while
  // also ensuring the sum is exactly 1.
  const lastCredit = round4(1 - sumExceptLast);
  results[n - 1]!.credit = lastCredit;

  return results;
}
