// funnel-calculator.ts — Výpočty drop-off rate a konverzního poměru.
// Čistě funkcionální, bez side-effectů — snadno testovatelné.

import { FUNNEL_STEPS, FunnelStep, FunnelStepStats } from '../types/funnel.types';

/**
 * Vypočítá statistiky pro každý krok funnelu.
 *
 * Pravidla:
 *  - První krok má dropOffRate = 0 (není předchozí krok)
 *  - dropOffCount = předchozí krok count − aktuální krok count (min 0)
 *  - dropOffRate = dropOffCount / předchozí krok count × 100, zaokrouhleno na 2 des. místa
 *  - Pokud je předchozí krok 0, dropOffRate = 0
 */
export function calculateFunnelStats(
  stepCounts: Record<FunnelStep, number>,
): FunnelStepStats[] {
  return FUNNEL_STEPS.map((step, index) => {
    const count = stepCounts[step] ?? 0;

    if (index === 0) {
      return {
        step,
        count,
        dropOffCount: 0,
        dropOffRate: 0,
      };
    }

    const prevStep = FUNNEL_STEPS[index - 1];
    const prevCount = stepCounts[prevStep] ?? 0;
    const dropOffCount = Math.max(0, prevCount - count);
    const dropOffRate =
      prevCount > 0
        ? Math.round((dropOffCount / prevCount) * 100 * 100) / 100
        : 0;

    return {
      step,
      count,
      dropOffCount,
      dropOffRate,
    };
  });
}

/**
 * Celkový konverzní poměr: podíl uživatelů co prošli celým funnelem.
 * = (count posledního kroku / count prvního kroku) × 100
 * Vrátí 0 pokud je první krok prázdný.
 */
export function calculateOverallConversionRate(steps: FunnelStepStats[]): number {
  if (steps.length === 0) return 0;
  const firstCount = steps[0].count;
  const lastCount = steps[steps.length - 1].count;
  if (firstCount === 0) return 0;
  return Math.round((lastCount / firstCount) * 100 * 100) / 100;
}
