/**
 * attribution-models.ts
 *
 * Multi-touch attribution model library. Mirrors the shape used by
 * affiliate-tracking so reports can share a common calculation core.
 *
 * All models return credit weights that sum to exactly 1.0 (subject to the
 * last touch absorbing floating point residue).
 */

import type { TouchPoint } from "../types/attribution.types";

export type AttributionModel =
  | "last_touch"
  | "first_touch"
  | "linear"
  | "time_decay"
  | "position_based";

/**
 * Distributes `orderRevenue` across channels according to `model`.
 * Returns a map of channel -> attributed revenue.
 * When `touchpoints` is empty an empty object is returned.
 */
export function attributeRevenue(
  touchpoints: TouchPoint[],
  orderRevenue: number,
  model: AttributionModel,
): Record<string, number> {
  if (touchpoints.length === 0) return {};

  const sorted = [...touchpoints].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const weights = computeWeights(sorted, model);

  const out: Record<string, number> = {};
  sorted.forEach((tp, i) => {
    const revenue = orderRevenue * weights[i]!;
    out[tp.channel] = (out[tp.channel] ?? 0) + revenue;
  });
  return out;
}

/**
 * Computes a parallel array of weights summing to 1.
 */
export function computeWeights(
  sorted: TouchPoint[],
  model: AttributionModel,
): number[] {
  const n = sorted.length;
  if (n === 0) return [];
  if (n === 1) return [1];

  switch (model) {
    case "last_touch": {
      const w = new Array<number>(n).fill(0);
      w[n - 1] = 1;
      return w;
    }
    case "first_touch": {
      const w = new Array<number>(n).fill(0);
      w[0] = 1;
      return w;
    }
    case "linear": {
      return new Array<number>(n).fill(1 / n);
    }
    case "time_decay": {
      // Exponential decay with 7-day half-life relative to the last touch.
      const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
      const lastTs = sorted[n - 1]!.createdAt.getTime();
      const raw = sorted.map((tp) => {
        const ageMs = lastTs - tp.createdAt.getTime();
        return Math.pow(0.5, ageMs / HALF_LIFE_MS);
      });
      const sum = raw.reduce((a, b) => a + b, 0);
      return raw.map((r) => r / sum);
    }
    case "position_based": {
      // U-shaped: 40% first, 40% last, 20% spread across middle.
      if (n === 2) return [0.5, 0.5];
      const w = new Array<number>(n).fill(0);
      w[0] = 0.4;
      w[n - 1] = 0.4;
      const middle = 0.2 / (n - 2);
      for (let i = 1; i < n - 1; i++) w[i] = middle;
      return w;
    }
  }
}
