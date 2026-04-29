// funnel-calculator.test.ts — 15+ testů pro čistou výpočetní logiku

import { describe, it, expect } from 'vitest';
import {
  calculateFunnelStats,
  calculateOverallConversionRate,
} from '../src/lib/funnel-calculator';
import { FUNNEL_STEPS, FunnelStep, FunnelStepStats } from '../src/types/funnel.types';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Vytvoří plný Record<FunnelStep, number> z částečných dat */
function makeCounts(partial: Partial<Record<FunnelStep, number>>): Record<FunnelStep, number> {
  const base = Object.fromEntries(FUNNEL_STEPS.map((s) => [s, 0])) as Record<FunnelStep, number>;
  return { ...base, ...partial };
}

// ─── calculateFunnelStats ───────────────────────────────────────────────────

describe('calculateFunnelStats', () => {
  it('vrátí správný počet kroků (5)', () => {
    const stats = calculateFunnelStats(makeCounts({}));
    expect(stats).toHaveLength(5);
  });

  it('kroky jsou ve správném pořadí', () => {
    const stats = calculateFunnelStats(makeCounts({}));
    expect(stats.map((s) => s.step)).toEqual(FUNNEL_STEPS);
  });

  it('první krok má dropOffRate = 0 i dropOffCount = 0', () => {
    const stats = calculateFunnelStats(makeCounts({ event_view: 1000 }));
    expect(stats[0].dropOffRate).toBe(0);
    expect(stats[0].dropOffCount).toBe(0);
  });

  it('first step count je správně přiřazen', () => {
    const stats = calculateFunnelStats(makeCounts({ view: 500 }));
    expect(stats[0].count).toBe(500);
  });

  it('dropOffCount = předchozí − aktuální', () => {
    const stats = calculateFunnelStats(
      makeCounts({ view: 1000, cart: 800 }),
    );
    const cartStep = stats.find((s) => s.step === 'cart')!;
    expect(cartStep.dropOffCount).toBe(200);
  });

  it('dropOffRate přesně na 2 des. místa — jednoduchý případ', () => {
    const stats = calculateFunnelStats(
      makeCounts({ view: 1000, cart: 750 }),
    );
    const cartStep = stats.find((s) => s.step === 'cart')!;
    expect(cartStep.dropOffRate).toBe(25);
  });

  it('dropOffRate přesně na 2 des. místa — necelé číslo', () => {
    const stats = calculateFunnelStats(
      makeCounts({ view: 3, cart: 1 }),
    );
    const cartStep = stats.find((s) => s.step === 'cart')!;
    // 2/3 * 100 = 66.666... → 66.67
    expect(cartStep.dropOffRate).toBe(66.67);
  });

  it('dropOffRate je 0 pokud aktuální count = předchozí count', () => {
    const stats = calculateFunnelStats(
      makeCounts({ view: 100, cart: 100 }),
    );
    const cartStep = stats.find((s) => s.step === 'cart')!;
    expect(cartStep.dropOffRate).toBe(0);
    expect(cartStep.dropOffCount).toBe(0);
  });

  it('dropOffCount nikdy nejde pod 0 (edge: aktuální > předchozí kvůli chybě dat)', () => {
    const stats = calculateFunnelStats(
      makeCounts({ view: 50, cart: 100 }),
    );
    const cartStep = stats.find((s) => s.step === 'cart')!;
    expect(cartStep.dropOffCount).toBe(0);
    expect(cartStep.dropOffRate).toBe(0);
  });

  it('dropOffRate = 0 pokud předchozí krok má count = 0', () => {
    const stats = calculateFunnelStats(
      makeCounts({ view: 0, cart: 0 }),
    );
    const cartStep = stats.find((s) => s.step === 'cart')!;
    expect(cartStep.dropOffRate).toBe(0);
  });

  it('ticket_issued step stats jsou správné', () => {
    const counts = makeCounts({
      view: 1000,
      cart: 800,
      checkout: 600,
      paid: 400,
      ticket_issued: 100,
    });
    const stats = calculateFunnelStats(counts);
    const last = stats[stats.length - 1];
    expect(last.step).toBe('ticket_issued');
    expect(last.count).toBe(100);
    expect(last.dropOffCount).toBe(300);
    expect(last.dropOffRate).toBe(75);
  });

  it('všechny kroky s nulami vrátí vše 0', () => {
    const stats = calculateFunnelStats(makeCounts({}));
    for (const s of stats) {
      expect(s.count).toBe(0);
      expect(s.dropOffCount).toBe(0);
      expect(s.dropOffRate).toBe(0);
    }
  });

  it('dropOffRate pro checkout je korektní přes více kroků', () => {
    const counts = makeCounts({
      view: 900,
      cart: 600,
      checkout: 450,
    });
    const stats = calculateFunnelStats(counts);
    const checkoutStep = stats.find((s) => s.step === 'checkout')!;
    // 150 / 600 * 100 = 25
    expect(checkoutStep.dropOffCount).toBe(150);
    expect(checkoutStep.dropOffRate).toBe(25);
  });

  it('paid dropOffRate je správné', () => {
    const counts = makeCounts({
      view: 1000,
      cart: 800,
      checkout: 700,
      paid: 500,
      ticket_issued: 300,
    });
    const stats = calculateFunnelStats(counts);
    const paidStep = stats.find((s) => s.step === 'paid')!;
    // 200 / 700 * 100 = 28.57...
    expect(paidStep.dropOffRate).toBe(28.57);
    expect(paidStep.dropOffCount).toBe(200);
  });

  it('necelý dropOffRate pro checkout se zaokrouhlí na 2 des. místa', () => {
    const counts = makeCounts({
      view: 7,
      cart: 7,
      checkout: 5,
    });
    const stats = calculateFunnelStats(counts);
    const checkStep = stats.find((s) => s.step === 'checkout')!;
    // 2/7 * 100 = 28.571... → 28.57
    expect(checkStep.dropOffRate).toBe(28.57);
  });
});

// ─── calculateOverallConversionRate ─────────────────────────────────────────

describe('calculateOverallConversionRate', () => {
  function makeStats(counts: Partial<Record<FunnelStep, number>>): FunnelStepStats[] {
    return calculateFunnelStats(makeCounts(counts));
  }

  it('vrátí 100 pokud všechny kroky mají stejný count', () => {
    const steps = makeStats(
      Object.fromEntries(FUNNEL_STEPS.map((s) => [s, 500])) as Partial<Record<FunnelStep, number>>,
    );
    expect(calculateOverallConversionRate(steps)).toBe(100);
  });

  it('vrátí 0 pokud první krok má count = 0', () => {
    const steps = makeStats({});
    expect(calculateOverallConversionRate(steps)).toBe(0);
  });

  it('standardní případ: 100 z 1000 = 10 %', () => {
    const steps = makeStats({
      view: 1000,
      cart: 800,
      checkout: 600,
      paid: 400,
      ticket_issued: 100,
    });
    expect(calculateOverallConversionRate(steps)).toBe(10);
  });

  it('prázdné pole vrátí 0', () => {
    expect(calculateOverallConversionRate([])).toBe(0);
  });

  it('necelé číslo je zaokrouhleno na 2 des. místa', () => {
    const steps = makeStats({
      view: 3,
      ticket_issued: 1,
    });
    // 1/3 * 100 = 33.333... → 33.33
    expect(calculateOverallConversionRate(steps)).toBe(33.33);
  });
});
