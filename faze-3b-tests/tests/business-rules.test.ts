/**
 * business-rules.test.ts
 *
 * Ověření klíčových business rules napříč moduly Fáze 3b.
 * Žádné IO — pouze čisté funkce z lib/ souborů.
 */

import { describe, it, expect } from 'vitest';

// Loyalty
import {
  calculateEarnedPoints,
  calculateDiscount,
  getTier,
} from '../../loyalty-points/src/lib/points-calculator';

// Affiliate
import {
  calculateCommission,
  isValidAffiliateCode,
  generateAffiliateCode,
} from '../../affiliate-tracking/src/lib/link-generator';

// Ambassador
import {
  isValidAmbassadorCode,
  generateAmbassadorCode,
} from '../../ambassador-management/src/lib/code-generator';

// Cart abandonment
import { assignAbVariant } from '../../cart-abandonment/src/lib/ab-variant';

// Re-engagement
import { getDormancyLevel } from '../../re-engagement/src/lib/dormancy';

// Funnel
import { calculateFunnelStats } from '../../conversion-funnel/src/lib/funnel-calculator';
import type { FunnelStep } from '../../conversion-funnel/src/types/funnel.types';
import { FUNNEL_STEPS } from '../../conversion-funnel/src/types/funnel.types';

// ---------------------------------------------------------------------------
// 1. Finanční výpočty vracejí INTEGER
// ---------------------------------------------------------------------------

describe('Business rule 1: Finanční výpočty vracejí INTEGER', () => {
  it('calculateCommission vrací integer', () => {
    expect(Number.isInteger(calculateCommission(100_000, 500))).toBe(true);
    expect(Number.isInteger(calculateCommission(99_999, 333))).toBe(true);
    expect(Number.isInteger(calculateCommission(1, 1))).toBe(true);
  });

  it('calculateEarnedPoints vrací integer', () => {
    expect(Number.isInteger(calculateEarnedPoints(100_000, 'bronze'))).toBe(true);
    expect(Number.isInteger(calculateEarnedPoints(99_999, 'silver'))).toBe(true);
    expect(Number.isInteger(calculateEarnedPoints(1, 'gold'))).toBe(true);
  });

  it('calculateDiscount vrací integer', () => {
    expect(Number.isInteger(calculateDiscount(1000))).toBe(true);
    expect(Number.isInteger(calculateDiscount(0))).toBe(true);
    expect(Number.isInteger(calculateDiscount(500))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. calculateCommission(100_000, 500) === 5000
// ---------------------------------------------------------------------------

describe('Business rule 2: calculateCommission(100_000, 500) === 5000', () => {
  it('1000 Kč × 5 % = 5000 haléřů (50 Kč)', () => {
    // orderAmount = 100_000 haléřů = 1000 Kč
    // commissionRateBps = 500 = 5 %
    // výsledek = Math.floor(100_000 * 500 / 10_000) = 5000 haléřů = 50 Kč
    expect(calculateCommission(100_000, 500)).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// 3. calculateEarnedPoints(100_000, 'bronze') === 1000
// ---------------------------------------------------------------------------

describe('Business rule 3: calculateEarnedPoints(100_000, "bronze") === 1000', () => {
  it('1000 Kč × 1 bod/Kč (bronze multiplier 1×) = 1000 bodů', () => {
    // orderAmount = 100_000 haléřů = 1000 Kč
    // bronze multiplier = 1
    // výsledek = Math.floor(1000 * 1) = 1000
    expect(calculateEarnedPoints(100_000, 'bronze')).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// 4. calculateDiscount: 100 bodů = 1 Kč = 100 haléřů → 1000 bodů = 1000 haléřů
// ---------------------------------------------------------------------------

describe('Business rule 4: calculateDiscount(1000) === 1000 haléřů', () => {
  it('1000 bodů = 1000 haléřů = 10 Kč (100 bodů = 1 Kč = 100 haléřů)', () => {
    // Spec: 100 bodů = 1 Kč = 100 haléřů
    // Proto 1000 bodů = 10 Kč = 1000 haléřů
    // Implementace: calculateDiscount(points) = points (body === haléře přímou konverzí)
    expect(calculateDiscount(1000)).toBe(1000);
  });

  it('calculateDiscount(500) === 500 haléřů = 5 Kč', () => {
    expect(calculateDiscount(500)).toBe(500);
  });

  it('calculateDiscount(0) === 0', () => {
    expect(calculateDiscount(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. assignAbVariant je deterministický
// ---------------------------------------------------------------------------

describe('Business rule 5: assignAbVariant je deterministický', () => {
  it('stejný userId = stejný variant při opakovaném volání', () => {
    const userId = 'deterministic-user-42';
    const runs = Array.from({ length: 10 }, () => assignAbVariant(userId));
    const allSame = runs.every((v) => v === runs[0]);
    expect(allSame).toBe(true);
  });

  it('různé userId produkují oba varianty (A i B)', () => {
    // Použijeme předem ověřené userId, které dávají oba výsledky:
    //   'alpha' → B, 'beta' → A (ověřeno offline s FNV-1a implementací)
    const seen = new Set<string>();
    const testIds = [
      'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta',
      'fan-presale', 'buyer-verified', 'promoter-x', 'admin-y',
    ];
    for (const id of testIds) {
      seen.add(assignAbVariant(id));
    }
    expect(seen.has('A')).toBe(true);
    expect(seen.has('B')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. isValidAffiliateCode a isValidAmbassadorCode odmítají speciální znaky
// ---------------------------------------------------------------------------

describe('Business rule 6: Validace kódů odmítá speciální znaky', () => {
  it('isValidAffiliateCode odmítá kódy se speciálními znaky', () => {
    expect(isValidAffiliateCode('ABC!1234')).toBe(false);
    expect(isValidAffiliateCode('ABC-1234')).toBe(false);
    expect(isValidAffiliateCode('ABC 1234')).toBe(false);
    expect(isValidAffiliateCode('ABC@1234')).toBe(false);
    expect(isValidAffiliateCode('')).toBe(false);
    expect(isValidAffiliateCode('ABC123')).toBe(false); // příliš krátký
  });

  it('isValidAffiliateCode přijímá validní 8-znakové base62 kódy', () => {
    expect(isValidAffiliateCode('ABCabc12')).toBe(true);
    expect(isValidAffiliateCode('12345678')).toBe(true);
    expect(isValidAffiliateCode('abcdefgh')).toBe(true);
    expect(isValidAffiliateCode('ABCDEFGH')).toBe(true);
  });

  it('isValidAmbassadorCode odmítá kódy se speciálními znaky', () => {
    expect(isValidAmbassadorCode('ABC!1234')).toBe(false);
    expect(isValidAmbassadorCode('ABC-1234')).toBe(false);
    expect(isValidAmbassadorCode('ABC 1234')).toBe(false);
    expect(isValidAmbassadorCode('')).toBe(false);
    // Ambassador kód nepovoluje O, 0, I, 1 a malá písmena
    expect(isValidAmbassadorCode('ABCDEFG0')).toBe(false); // 0 není v CHARSET
    expect(isValidAmbassadorCode('abcdefgh')).toBe(false); // malá písmena
  });

  it('isValidAmbassadorCode přijímá validní 8-znakové kódy', () => {
    // CHARSET: ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (bez O, 0, I, 1)
    expect(isValidAmbassadorCode('ABCDEFGH')).toBe(true);
    expect(isValidAmbassadorCode('23456789')).toBe(true);
    expect(isValidAmbassadorCode('ABCD2345')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. generateAffiliateCode a generateAmbassadorCode vracejí 8-znakové řetězce
// ---------------------------------------------------------------------------

describe('Business rule 7: Generátory kódů vrací 8 znaků', () => {
  it('generateAffiliateCode vrátí string délky 8', () => {
    for (let i = 0; i < 5; i++) {
      const code = generateAffiliateCode();
      expect(code).toHaveLength(8);
      expect(typeof code).toBe('string');
    }
  });

  it('generateAmbassadorCode vrátí string délky 8', () => {
    for (let i = 0; i < 5; i++) {
      const code = generateAmbassadorCode();
      expect(code).toHaveLength(8);
      expect(typeof code).toBe('string');
    }
  });

  it('generované kódy jsou validní', () => {
    expect(isValidAffiliateCode(generateAffiliateCode())).toBe(true);
    expect(isValidAmbassadorCode(generateAmbassadorCode())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. getDormancyLevel vrátí null pro aktivního uživatele (< 60 dní)
// ---------------------------------------------------------------------------

describe('Business rule 8: getDormancyLevel null pro aktivního uživatele', () => {
  const NOW = new Date('2026-04-05T00:00:00Z');

  it('vrátí null pro nákup před 10 dny', () => {
    const lastPurchase = new Date('2026-03-26T00:00:00Z'); // 10 dní
    expect(getDormancyLevel(lastPurchase, NOW)).toBeNull();
  });

  it('vrátí null pro nákup před 59 dny', () => {
    const lastPurchase = new Date('2026-02-05T00:00:00Z'); // 59 dní
    expect(getDormancyLevel(lastPurchase, NOW)).toBeNull();
  });

  it('vrátí "at_risk" pro nákup přesně před 60 dny', () => {
    const lastPurchase = new Date('2026-02-04T00:00:00Z'); // 60 dní
    expect(getDormancyLevel(lastPurchase, NOW)).toBe('at_risk');
  });
});

// ---------------------------------------------------------------------------
// 9. getDormancyLevel vrátí "churned" pro 180+ dní
// ---------------------------------------------------------------------------

describe('Business rule 9: getDormancyLevel "churned" pro 180+ dní', () => {
  const NOW = new Date('2026-04-05T00:00:00Z');

  it('vrátí "churned" pro nákup před 180 dny přesně', () => {
    // 180 dní zpět od 2026-04-05 = 2025-10-07
    const lastPurchase = new Date('2025-10-07T00:00:00Z');
    expect(getDormancyLevel(lastPurchase, NOW)).toBe('churned');
  });

  it('vrátí "churned" pro nákup před 365 dny', () => {
    const lastPurchase = new Date('2025-04-05T00:00:00Z'); // 365 dní
    expect(getDormancyLevel(lastPurchase, NOW)).toBe('churned');
  });

  it('vrátí "dormant" (ne "churned") pro 179 dní', () => {
    const lastPurchase = new Date('2025-10-08T00:00:00Z'); // 179 dní
    expect(getDormancyLevel(lastPurchase, NOW)).toBe('dormant');
  });
});

// ---------------------------------------------------------------------------
// 10. calculateFunnelStats: dropOffRate prvního kroku === 0
// ---------------------------------------------------------------------------

describe('Business rule 10: calculateFunnelStats dropOffRate prvního kroku', () => {
  it('dropOffRate prvního kroku je vždy 0', () => {
    const stepCounts: Record<FunnelStep, number> = {
      event_view: 1000,
      ticket_selection: 750,
      seat_selection: 600,
      checkout_start: 500,
      payment_info: 400,
      order_complete: 300,
    };
    const stats = calculateFunnelStats(stepCounts);
    expect(stats[0]!.step).toBe(FUNNEL_STEPS[0]); // 'event_view'
    expect(stats[0]!.dropOffRate).toBe(0);
    expect(stats[0]!.dropOffCount).toBe(0);
  });

  it('dropOffRate druhého kroku je správně vypočten', () => {
    const stepCounts: Record<FunnelStep, number> = {
      event_view: 1000,
      ticket_selection: 750,
      seat_selection: 600,
      checkout_start: 500,
      payment_info: 400,
      order_complete: 300,
    };
    const stats = calculateFunnelStats(stepCounts);
    // event_view: 1000 → ticket_selection: 750 → drop = 250 → 25.00 %
    expect(stats[1]!.step).toBe('ticket_selection');
    expect(stats[1]!.dropOffCount).toBe(250);
    expect(stats[1]!.dropOffRate).toBe(25);
  });

  it('calculateFunnelStats funguje i pro nulové hodnoty', () => {
    const stepCounts: Record<FunnelStep, number> = {
      event_view: 0,
      ticket_selection: 0,
      seat_selection: 0,
      checkout_start: 0,
      payment_info: 0,
      order_complete: 0,
    };
    const stats = calculateFunnelStats(stepCounts);
    stats.forEach((s) => {
      expect(s.dropOffRate).toBe(0);
    });
  });
});
