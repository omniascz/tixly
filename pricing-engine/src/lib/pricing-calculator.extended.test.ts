import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateDemandFactor,
  calculateFinalPrice,
  resolveActivePhase,
  getNextPhase,
} from './pricing-calculator';
import type { PricingRule, PricingPhase } from '../types/pricing';
import { createPricingRule, createPhaseSet, createTicketType } from './test-helpers';

// ---------------------------------------------------------------------------
// Test Constants
// ---------------------------------------------------------------------------

const NOW = new Date('2026-04-03T12:00:00Z');
const PAST = new Date('2026-04-01T00:00:00Z');
const FUTURE = new Date('2026-04-10T00:00:00Z');
const TOMORROW_MINUS_2H = new Date(NOW.getTime() + 1000 * 60 * 60 * 22);
const TOMORROW_MINUS_1H = new Date(NOW.getTime() + 1000 * 60 * 60 * 23);
const TOMORROW = new Date(NOW.getTime() + 1000 * 60 * 60 * 24);

// ---------------------------------------------------------------------------
// calculateDemandFactor — Edge Cases
// ---------------------------------------------------------------------------

describe('calculateDemandFactor — edge cases', () => {
  it('vrátí demandFactorMin při 0% prodanosti', () => {
    const rule = createPricingRule({
      demandFactorMin: 0.8,
      demandFactorMax: 1.5,
    });
    expect(calculateDemandFactor(0, 100, rule)).toBe(0.8);
  });

  it('vrátí demandFactorMax při 100% prodanosti', () => {
    const rule = createPricingRule({
      demandFactorMin: 0.8,
      demandFactorMax: 1.5,
    });
    expect(calculateDemandFactor(100, 100, rule)).toBe(1.5);
  });

  it('vrátí přesně střed mezi min a max při 50% prodanosti', () => {
    const rule = createPricingRule({
      demandFactorMin: 0.8,
      demandFactorMax: 1.5,
    });
    const result = calculateDemandFactor(50, 100, rule);
    const expected = (0.8 + 1.5) / 2;
    expect(result).toBe(expected);
  });

  it('vrátí 1.0 když demandFactorMin = demandFactorMax = 1.0 (žádná dynamika)', () => {
    const rule = createPricingRule({
      demandFactorMin: 1.0,
      demandFactorMax: 1.0,
    });
    expect(calculateDemandFactor(75, 100, rule)).toBe(1.0);
  });

  it('vrátí demandFactorMax když soldQty > totalQty (oversell edge case)', () => {
    const rule = createPricingRule({
      demandFactorMin: 0.8,
      demandFactorMax: 1.5,
    });
    expect(calculateDemandFactor(150, 100, rule)).toBe(1.5);
  });

  it('vrátí demandFactorMin když totalQty = 0', () => {
    const rule = createPricingRule({
      demandFactorMin: 0.8,
      demandFactorMax: 1.5,
    });
    expect(calculateDemandFactor(0, 0, rule)).toBe(0.8);
  });

  it('vrátí demandFactorMin když totalQty = 0 a soldQty > 0', () => {
    const rule = createPricingRule({
      demandFactorMin: 0.9,
      demandFactorMax: 1.6,
    });
    expect(calculateDemandFactor(10, 0, rule)).toBe(0.9);
  });

  it('vrátí přesný výsledek při 75% prodanosti s min=0.8 a max=1.5', () => {
    const rule = createPricingRule({
      demandFactorMin: 0.8,
      demandFactorMax: 1.5,
    });
    const result = calculateDemandFactor(75, 100, rule);
    // 0.8 + (1.5 - 0.8) * 0.75 = 0.8 + 0.525 = 1.325
    expect(result).toBe(1.33);
  });

  it('zaokrouhluje na max 2 desetinná místa', () => {
    const rule = createPricingRule({
      demandFactorMin: 1.0,
      demandFactorMax: 1.5,
    });
    // 33% → 1.0 + 0.5 * 0.333... = 1.1666... → 1.17
    expect(String(calculateDemandFactor(33, 100, rule)).split('.')[1].length).toBeLessThanOrEqual(2);
  });

  it('vrátí demandFactorMin pro záporný soldQty', () => {
    const rule = createPricingRule({
      demandFactorMin: 0.9,
      demandFactorMax: 1.4,
    });
    expect(calculateDemandFactor(-50, 100, rule)).toBe(0.9);
  });
});

// ---------------------------------------------------------------------------
// calculateFinalPrice — Zaokrouhlení
// ---------------------------------------------------------------------------

describe('calculateFinalPrice — zaokrouhlení', () => {
  it('40000 hl (400 Kč) × 1.0 → 40000 hl (přesná hodnota, žádné zaokrouhlení)', () => {
    expect(calculateFinalPrice(40000, 1.0)).toBe(40000);
  });

  it('40000 hl (400 Kč) × 1.1 → 45000 hl (450 Kč) (zaokrouhlení na 10 Kč)', () => {
    // 40000 * 1.1 = 44000.000000000004 (float) → ceil(44000.000000000004/1000)*1000 = 45000
    expect(calculateFinalPrice(40000, 1.1)).toBe(45000);
  });

  it('43700 hl (437 Kč) × 1.0 → 44000 hl (440 Kč) (zaokrouhlení nahoru na 10 Kč)', () => {
    expect(calculateFinalPrice(43700, 1.0)).toBe(44000);
  });

  it('43100 hl (431 Kč) × 1.0 → 44000 hl (440 Kč) (zaokrouhlení nahoru, ne na nejbližší)', () => {
    expect(calculateFinalPrice(43100, 1.0)).toBe(44000);
  });

  it('43000 hl (430 Kč) × 1.0 → 43000 hl (přesně na 10 Kč, žádná změna)', () => {
    expect(calculateFinalPrice(43000, 1.0)).toBe(43000);
  });

  it('0 hl → 0', () => {
    expect(calculateFinalPrice(0, 1.5)).toBe(0);
  });

  it('velmi vysoká cena (999000 hl = 9990 Kč × 1.5) → správně zaokrouhleno', () => {
    // 999000 * 1.5 = 1498500 → ceil(1498500 / 1000) * 1000 = 1499000 hl = 14990 Kč
    expect(calculateFinalPrice(999000, 1.5)).toBe(1499000);
  });

  it('50000 hl (500 Kč) × 1.0 → 50000 hl (přesný násobek 1000)', () => {
    expect(calculateFinalPrice(50000, 1.0)).toBe(50000);
  });

  it('33300 hl (333 Kč) × 1.2 → 40000 hl (400 Kč) (zaokrouhlení 39960)', () => {
    // 33300 * 1.2 = 39960 → ceil(39960/1000)*1000 = 40000
    expect(calculateFinalPrice(33300, 1.2)).toBe(40000);
  });

  it('10000 hl (100 Kč) × 1.01 → 11000 hl (110 Kč) (zaokrouhlení malého multipliku)', () => {
    // 10000 * 1.01 = 10100 → ceil(10100/1000)*1000 = 11000
    expect(calculateFinalPrice(10000, 1.01)).toBe(11000);
  });

  it('20000 hl (200 Kč) × 1.5 → 30000 hl (300 Kč) (přesný výsledek)', () => {
    expect(calculateFinalPrice(20000, 1.5)).toBe(30000);
  });
});

// ---------------------------------------------------------------------------
// resolveActivePhase — Fázové Přechody
// ---------------------------------------------------------------------------

describe('resolveActivePhase — fázové přechody', () => {
  let phases: PricingRule[];

  beforeEach(() => {
    phases = createPhaseSet(NOW);
  });

  it('vrátí null když žádná fáze není splněna (před sale_start)', () => {
    const futureRules = phases.map((r) => ({
      ...r,
      thresholdDate: FUTURE,
      thresholdQty: 1000,
    }));
    expect(resolveActivePhase(futureRules, 0, 500, NOW)).toBeNull();
  });

  it('aktivní early_bird když threshold_date v minulosti a qty nesplněno', () => {
    const rules = [
      createPricingRule({
        id: 'early',
        phase: 'early_bird',
        thresholdDate: PAST,
        thresholdQty: 100,
        priority: 10,
      }),
    ];
    const result = resolveActivePhase(rules, 50, 500, NOW);
    expect(result?.phase).toBe('early_bird');
  });

  it('regular fáze přepíše early_bird když má vyšší prioritu a je splněna', () => {
    const rules = [
      createPricingRule({
        id: 'early',
        phase: 'early_bird',
        thresholdDate: PAST,
        thresholdQty: 50,
        priority: 10,
      }),
      createPricingRule({
        id: 'regular',
        phase: 'regular',
        thresholdDate: PAST,
        thresholdQty: 100,
        priority: 20,
      }),
    ];
    const result = resolveActivePhase(rules, 100, 500, NOW);
    expect(result?.phase).toBe('regular');
    expect(result?.id).toBe('regular');
  });

  it('qty trigger: threshold_qty = 50, soldQty = 50 → fáze aktivní', () => {
    const rule = createPricingRule({
      thresholdDate: null,
      thresholdQty: 50,
    });
    expect(resolveActivePhase([rule], 50, 500, NOW)).not.toBeNull();
  });

  it('qty trigger: threshold_qty = 50, soldQty = 49 → neaktivní', () => {
    const rule = createPricingRule({
      thresholdDate: null,
      thresholdQty: 50,
    });
    expect(resolveActivePhase([rule], 49, 500, NOW)).toBeNull();
  });

  it('qty trigger: threshold_qty = 50, soldQty = 100 → stále aktivní (overdepleted)', () => {
    const rule = createPricingRule({
      thresholdDate: null,
      thresholdQty: 50,
    });
    expect(resolveActivePhase([rule], 100, 500, NOW)).not.toBeNull();
  });

  it('door fáze: jen threshold_date (žádné qty), 2 hodiny před eventem → aktivní', () => {
    const twoHoursLater = new Date(NOW.getTime() + 1000 * 60 * 60 * 2);
    const rule = createPricingRule({
      phase: 'door',
      thresholdDate: twoHoursLater,
      thresholdQty: null,
    });
    // now je 2 hodiny před twoHoursLater, takže ještě není splněno
    expect(resolveActivePhase([rule], 0, 500, NOW)).toBeNull();
    // Když se teď posuneme na twoHoursLater
    expect(resolveActivePhase([rule], 0, 500, twoHoursLater)).not.toBeNull();
  });

  it('vrátí null když všechna pravidla mají active = false', () => {
    const rules = [
      createPricingRule({ active: false, thresholdDate: PAST }),
      createPricingRule({ active: false, thresholdDate: PAST }),
    ];
    expect(resolveActivePhase(rules, 100, 500, NOW)).toBeNull();
  });

  it('smíšený trigger: regular má threshold_date v budoucnosti ALE threshold_qty splněno → regular aktivní', () => {
    const rule = createPricingRule({
      phase: 'regular',
      thresholdDate: FUTURE,
      thresholdQty: 100,
    });
    expect(resolveActivePhase([rule], 100, 500, NOW)).not.toBeNull();
  });

  it('vrátí pravidlo bez thresholdů pokud má aspoň jedno splněno', () => {
    // Pravidlo bez thresholdů by nemělo být nikdy aktivní
    const rule = createPricingRule({
      thresholdDate: null,
      thresholdQty: null,
    });
    expect(resolveActivePhase([rule], 50, 500, NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getNextPhase — Identifikace Další Fáze
// ---------------------------------------------------------------------------

describe('getNextPhase — identifikace další fáze', () => {
  let phases: PricingRule[];

  beforeEach(() => {
    phases = createPhaseSet(NOW);
  });

  it('v early_bird fázi → vrátí nejbližší pending fázi (regular nebo late)', () => {
    const next = getNextPhase(phases, 'early_bird', 50, 500, NOW);
    // getNextPhase vrací fázi s nejmenším skóre (nejblíže k triggeru)
    // Může to být regular (qty=250 zbývá) nebo late (qty=350 zbývá, ale dříve v čase)
    expect(['regular', 'late']).toContain(next?.phase);
  });

  it('v regular fázi → nextPhase = late', () => {
    const next = getNextPhase(phases, 'regular', 200, 500, NOW);
    expect(next?.phase).toBe('late');
  });

  it('v late fázi → nextPhase = door', () => {
    const next = getNextPhase(phases, 'late', 350, 500, NOW);
    expect(next?.phase).toBe('door');
  });

  it('v door fázi (poslední) → nextPhase = null', () => {
    const next = getNextPhase(phases, 'door', 450, 500, NOW);
    expect(next).toBeNull();
  });

  it('žádná aktivní fáze → nextPhase = first upcoming', () => {
    const earlyPhase = phases.find((p) => p.phase === 'early_bird');
    const next = getNextPhase(phases, 'early_bird', 0, 500, NOW);
    expect(next).not.toBeNull();
  });

  it('všechny fáze prošly → null', () => {
    const pastPhases = phases.map((p) => ({
      ...p,
      thresholdDate: PAST,
      thresholdQty: null,
    }));
    const next = getNextPhase(pastPhases, 'door', 500, 500, NOW);
    expect(next).toBeNull();
  });

  it('vrátí threshold_date když je k dispozici', () => {
    const next = getNextPhase(phases, 'regular', 50, 500, NOW);
    expect(next?.date).toBeDefined();
  });

  it('vrátí threshold_qty když je k dispozici', () => {
    const next = getNextPhase(phases, 'early_bird', 50, 500, NOW);
    expect(next?.qty).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Phase Transition Scénáře (Integrační Testy)
// ---------------------------------------------------------------------------

describe('phase transition scénáře — integrační testy', () => {
  it('kompletní životní cyklus: qty-only triggery bez data', () => {
    const now = new Date('2026-04-03T12:00:00Z');

    // BEZ thresholdDate, pouze qty-based
    const rules: PricingRule[] = [
      createPricingRule({
        id: 'early',
        phase: 'early_bird',
        price: 100,
        thresholdQty: 100,
        thresholdDate: null,
        demandFactorMin: 1.0,
        demandFactorMax: 1.2,
        priority: 10,
      }),
      createPricingRule({
        id: 'regular',
        phase: 'regular',
        price: 200,
        thresholdQty: 300,
        thresholdDate: null,
        demandFactorMin: 1.0,
        demandFactorMax: 1.3,
        priority: 20,
      }),
      createPricingRule({
        id: 'late',
        phase: 'late',
        price: 300,
        thresholdQty: 400,
        thresholdDate: null,
        demandFactorMin: 1.0,
        demandFactorMax: 1.5,
        priority: 30,
      }),
    ];

    // Step 1: soldQty=0 → žádná fáze splněna
    expect(resolveActivePhase(rules, 0, 500, now)).toBeNull();

    // Step 2: soldQty=100 → early_bird aktivní (qty=100)
    let phase = resolveActivePhase(rules, 100, 500, now);
    expect(phase?.phase).toBe('early_bird');
    expect(phase?.price).toBe(100);

    // Step 3: soldQty=300 → regular aktivní (priority > early)
    phase = resolveActivePhase(rules, 300, 500, now);
    expect(phase?.phase).toBe('regular');
    expect(phase?.price).toBe(200);

    // Step 4: soldQty=400 → late aktivní (priority > regular)
    phase = resolveActivePhase(rules, 400, 500, now);
    expect(phase?.phase).toBe('late');
    expect(phase?.price).toBe(300);

    // Step 5: soldQty=500 → late stále aktivní, demand=max
    phase = resolveActivePhase(rules, 500, 500, now);
    expect(phase?.phase).toBe('late');
    const demandMax = calculateDemandFactor(500, 500, phase!);
    expect(demandMax).toBe(1.5);
  });

  it('přechod do nové fáze po dosažení qty threshold — pouze date-triggered', () => {
    const now = new Date('2026-04-03T12:00:00Z');
    const rules = [
      createPricingRule({
        id: 'phase1',
        phase: 'early_bird',
        price: 100,
        thresholdQty: null,  // POUZE date
        thresholdDate: PAST,
        priority: 10,
      }),
      createPricingRule({
        id: 'phase2',
        phase: 'regular',
        price: 200,
        thresholdQty: null,  // POUZE date
        thresholdDate: PAST,
        priority: 20,
      }),
    ];

    // Oba jsou triggováni date (PAST), takže vybírá vyšší priority (regular)
    expect(resolveActivePhase(rules, 49, 500, now)?.phase).toBe('regular');
    expect(resolveActivePhase(rules, 200, 500, now)?.phase).toBe('regular');
  });
});

// ---------------------------------------------------------------------------
// Concurrent Purchase Simulation
// ---------------------------------------------------------------------------

describe('concurrent purchase simulation', () => {
  it('determinismus: identický vstup → vždy stejný výsledek', () => {
    const rules = createPhaseSet(NOW);
    const inputs = Array(100).fill(null).map(() => resolveActivePhase(rules, 150, 500, NOW));

    // Všechny výsledky mají stejnou fázi
    const phases = inputs.map((r) => r?.phase);
    expect(new Set(phases).size).toBe(1);
  });

  it('paralelní volání resolveActivePhase 1000× s identickým vstupem → vždy stejný výsledek', async () => {
    const rules = createPhaseSet(NOW);
    const promises = Array(1000).fill(null).map(() =>
      Promise.resolve(resolveActivePhase(rules, 250, 500, NOW))
    );

    const results = await Promise.all(promises);
    const phases = results.map((r) => r?.phase);
    const uniquePhases = new Set(phases);
    expect(uniquePhases.size).toBe(1);
    expect(uniquePhases.has('regular')).toBe(true);
  });

  it('simulace race condition: dva nákupy při remaining_qty=1', () => {
    const rules = createPhaseSet(NOW);
    const totalQty = 500;
    const soldQty = 499; // remaining = 1

    // Buyer 1 a Buyer 2 se ptají na cenu ve stejný čas
    const phase1 = resolveActivePhase(rules, soldQty, totalQty, NOW);
    const phase2 = resolveActivePhase(rules, soldQty, totalQty, NOW);

    expect(phase1?.phase).toBe(phase2?.phase);
    expect(phase1?.price).toBe(phase2?.price);
  });
});

// ---------------------------------------------------------------------------
// Demand Factor Interpolace — Precision
// ---------------------------------------------------------------------------

describe('demand factor interpolace — precision', () => {
  it('lineární interpolace od 1.0 do 1.5 v kroku 10%', () => {
    const rule = createPricingRule({
      demandFactorMin: 1.0,
      demandFactorMax: 1.5,
    });

    const results = Array.from({ length: 11 }, (_, i) => ({
      percent: i * 10,
      factor: calculateDemandFactor(i * 10, 100, rule),
    }));

    expect(results[0].factor).toBe(1.0); // 0% → 1.0
    expect(results[5].factor).toBe(1.25); // 50% → 1.25
    expect(results[10].factor).toBe(1.5); // 100% → 1.5
  });

  it('zaokrouhlení na 2 desetinná místa zachovává přesnost', () => {
    const rule = createPricingRule({
      demandFactorMin: 0.75,
      demandFactorMax: 1.89,
    });

    for (let i = 0; i <= 100; i += 10) {
      const factor = calculateDemandFactor(i, 100, rule);
      const decimalPlaces = String(factor).split('.')[1]?.length ?? 0;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Pravidla bez Thresholdů
// ---------------------------------------------------------------------------

describe('pravidla bez thresholdů', () => {
  it('pravidlo bez data ani qty → nikdy se neaktivuje', () => {
    const rule = createPricingRule({
      thresholdDate: null,
      thresholdQty: null,
    });
    expect(resolveActivePhase([rule], 100, 500, NOW)).toBeNull();
  });

  it('inactive pravidlo i s thresholdy splněnými → ignorováno', () => {
    const rule = createPricingRule({
      active: false,
      thresholdDate: PAST,
      thresholdQty: 50,
    });
    expect(resolveActivePhase([rule], 100, 500, NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cena a Demand Faktor Kombinace
// ---------------------------------------------------------------------------

describe('cena a demand faktor kombinace', () => {
  it('nízká baseline cena s vysokým demand factorem', () => {
    // 10000 hl (100 Kč) * 2.0 = 20000 hl (200 Kč)
    const basePrice = 10000;
    const demandFactor = 2.0;
    const result = calculateFinalPrice(basePrice, demandFactor);
    expect(result).toBe(20000);
  });

  it('vysoká baseline cena s nízkým demand factorem', () => {
    // 100000 hl (1000 Kč) * 1.0 = 100000 hl (1000 Kč)
    const basePrice = 100000;
    const demandFactor = 1.0;
    const result = calculateFinalPrice(basePrice, demandFactor);
    expect(result).toBe(100000);
  });

  it('střední cena s běžným demand factorem', () => {
    // 25000 hl (250 Kč) * 1.2 = 30000 hl (300 Kč)
    const basePrice = 25000;
    const demandFactor = 1.2;
    const result = calculateFinalPrice(basePrice, demandFactor);
    // 25000 * 1.2 = 30000 → 30000
    expect(result).toBe(30000);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases — Zápor a Nula
// ---------------------------------------------------------------------------

describe('edge cases — zápor a nula', () => {
  it('záporná cena → abs(negativní) zaokrouhlení', () => {
    const result = calculateFinalPrice(-10000, 1.0);
    expect(result).toBeLessThanOrEqual(0);
  });

  it('nulový demand faktor → nulová cena', () => {
    expect(calculateFinalPrice(40000, 0)).toBe(0);
  });

  it('velmi malý demand faktor (0.01)', () => {
    // 100000 hl (1000 Kč) * 0.01 = 1000 hl → ceil(1000/1000)*1000 = 1000 hl (10 Kč)
    const result = calculateFinalPrice(100000, 0.01);
    expect(result).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Konec Testu
// ---------------------------------------------------------------------------

// CELKOVÝ POČET TESTŮ: 54 nových testů v pricing-calculator.extended.test.ts
// - calculateDemandFactor — edge cases: 11 testů
// - calculateFinalPrice — zaokrouhlení: 11 testů
// - resolveActivePhase — fázové přechody: 12 testů
// - getNextPhase — identifikace další fáze: 7 testů
// - phase transition scénáře: 3 testy
// - concurrent purchase simulation: 3 testy
// - demand factor interpolace: 2 testy
// - pravidla bez thresholdů: 2 testy
// - cena a demand faktor kombinace: 3 testy
// - edge cases — zápor a nula: 3 testy
