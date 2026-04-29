// =============================================================================
// Vitest unit testy — čistá logika dashboard utility funkcí
// Spuštění: vitest run src/lib/dashboard.test.ts
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  calculateFillPercent,
  normalizeHeatmapIntensity,
  formatRevenue,
  getPhaseForTimestamp,
  calculateTrend,
  buildZoneCapacity,
  type PricingRule,
} from "./dashboard";
import type { HeatmapCell } from "@/types/dashboard";

// ===========================================================================
// calculateFillPercent
// ===========================================================================

describe("calculateFillPercent", () => {
  it("vrátí 0 % při 0 prodaných sedadlech", () => {
    expect(calculateFillPercent(0, 100)).toBe(0);
  });

  it("vrátí 100 % při plné kapacitě", () => {
    expect(calculateFillPercent(100, 100)).toBe(100);
  });

  it("vrátí 100 % při oversold (sold > total)", () => {
    expect(calculateFillPercent(110, 100)).toBe(100);
  });

  it("správně počítá 50 % (bez locked)", () => {
    expect(calculateFillPercent(50, 100)).toBe(50);
  });

  it("zahrnuje locked seats do výpočtu", () => {
    // 30 sold + 20 locked = 50 / 100 = 50 %
    expect(calculateFillPercent(30, 100, 20)).toBe(50);
  });

  it("vrátí 100 % při kombinaci oversold + locked", () => {
    expect(calculateFillPercent(90, 100, 20)).toBe(100);
  });

  it("vrátí 0 % při totalSeats = 0 (zabraňuje dělení nulou)", () => {
    expect(calculateFillPercent(0, 0)).toBe(0);
  });

  it("zaokrouhluje na 1 desetinné místo", () => {
    // 1 / 3 = 33.333... → 33.3
    expect(calculateFillPercent(1, 3)).toBe(33.3);
  });

  it("vrátí 66.7 % pro 2/3", () => {
    expect(calculateFillPercent(2, 3)).toBe(66.7);
  });
});

// ===========================================================================
// normalizeHeatmapIntensity
// ===========================================================================

describe("normalizeHeatmapIntensity", () => {
  it("max buňka má intensity = 1.0", () => {
    const cells = [
      { dayOfWeek: 1, hour: 10, salesCount: 100 },
      { dayOfWeek: 2, hour: 14, salesCount: 50 },
      { dayOfWeek: 3, hour: 20, salesCount: 25 },
    ];
    const result = normalizeHeatmapIntensity(cells);
    const maxCell = result.find((c) => c.salesCount === 100);
    expect(maxCell?.intensity).toBe(1.0);
  });

  it("buňka s 0 prodeji má intensity = 0.0", () => {
    const cells = [
      { dayOfWeek: 1, hour: 10, salesCount: 50 },
      { dayOfWeek: 2, hour: 14, salesCount: 0 },
    ];
    const result = normalizeHeatmapIntensity(cells);
    const zeroCell = result.find((c) => c.salesCount === 0);
    expect(zeroCell?.intensity).toBe(0.0);
  });

  it("proporcionální výpočet: 50 / 100 = 0.5", () => {
    const cells = [
      { dayOfWeek: 1, hour: 10, salesCount: 100 },
      { dayOfWeek: 2, hour: 14, salesCount: 50 },
    ];
    const result = normalizeHeatmapIntensity(cells);
    const halfCell = result.find((c) => c.salesCount === 50);
    expect(halfCell?.intensity).toBe(0.5);
  });

  it("při všech nulových hodnotách vrátí všechna intensity = 0", () => {
    const cells = [
      { dayOfWeek: 0, hour: 0, salesCount: 0 },
      { dayOfWeek: 1, hour: 1, salesCount: 0 },
    ];
    const result = normalizeHeatmapIntensity(cells);
    result.forEach((c) => expect(c.intensity).toBe(0));
  });

  it("vrátí prázdné pole pro prázdný vstup", () => {
    expect(normalizeHeatmapIntensity([])).toEqual([]);
  });

  it("zachová dayOfWeek a hour z původních buněk", () => {
    const cells = [{ dayOfWeek: 3, hour: 15, salesCount: 42 }];
    const result = normalizeHeatmapIntensity(cells);
    expect(result[0]?.dayOfWeek).toBe(3);
    expect(result[0]?.hour).toBe(15);
    expect(result[0]?.salesCount).toBe(42);
  });

  it("vrátí správné intensity pro 3 různé hodnoty", () => {
    const cells = [
      { dayOfWeek: 1, hour: 10, salesCount: 200 },
      { dayOfWeek: 2, hour: 11, salesCount: 100 },
      { dayOfWeek: 3, hour: 12, salesCount: 0 },
    ];
    const result = normalizeHeatmapIntensity(cells);
    expect(result[0]?.intensity).toBe(1.0);
    expect(result[1]?.intensity).toBe(0.5);
    expect(result[2]?.intensity).toBe(0.0);
  });
});

// ===========================================================================
// formatRevenue
// ===========================================================================

describe("formatRevenue", () => {
  it("formátuje velké číslo s mezerami: 1234567 → '1 234 567 Kč'", () => {
    // cs-CZ Intl používá nezalomitelnou mezeru (U+00A0) jako skupinový oddělovač
    const result = formatRevenue(1234567);
    // Ověříme přítomnost "1", "234", "567" a "Kč"
    expect(result).toContain("1");
    expect(result).toContain("234");
    expect(result).toContain("567");
    expect(result).toContain("Kč");
  });

  it("formátuje 0 → '0 Kč'", () => {
    expect(formatRevenue(0)).toBe("0 Kč");
  });

  it("zaokrouhluje desetinná čísla", () => {
    const result = formatRevenue(1234.56);
    expect(result).toContain("1");
    expect(result).toContain("235"); // zaokrouhleno na 1235
    expect(result).toContain("Kč");
  });

  it("formátuje záporné číslo", () => {
    const result = formatRevenue(-500);
    expect(result).toContain("500");
    expect(result).toContain("Kč");
  });

  it("formátuje jednociferné číslo: 5 → '5 Kč'", () => {
    expect(formatRevenue(5)).toBe("5 Kč");
  });

  it("formátuje třímístné číslo bez oddělovače: 999 → '999 Kč'", () => {
    expect(formatRevenue(999)).toBe("999 Kč");
  });

  it("vrátí '0 Kč' pro NaN / Infinity", () => {
    expect(formatRevenue(NaN)).toBe("0 Kč");
    expect(formatRevenue(Infinity)).toBe("0 Kč");
  });
});

// ===========================================================================
// getPhaseForTimestamp
// ===========================================================================

describe("getPhaseForTimestamp", () => {
  const baseDate = new Date("2026-01-15T12:00:00Z");

  // Mock pricing rules pro event
  const mockRules: PricingRule[] = [
    // Early bird: aktivní do 31.1.2026
    {
      phase: "early_bird",
      thresholdDate: new Date("2026-01-31T23:59:59Z"),
      priority: 1,
      active: true,
    },
    // Regular: aktivní od 1.2.2026
    {
      phase: "regular",
      thresholdDate: new Date("2026-02-01T00:00:00Z"),
      priority: 2,
      active: true,
    },
    // Late: aktivní od 1.3.2026
    {
      phase: "late",
      thresholdDate: new Date("2026-03-01T00:00:00Z"),
      priority: 3,
      active: true,
    },
    // Door: aktivní od 1.4.2026
    {
      phase: "door",
      thresholdDate: new Date("2026-04-01T00:00:00Z"),
      priority: 4,
      active: true,
    },
  ];

  it("vrátí 'early_bird' pro datum v early bird periodu", () => {
    const result = getPhaseForTimestamp(baseDate, mockRules);
    // 15.1.2026 — pouze early_bird má thresholdDate ≤ 15.1.2026
    expect(result).toBe("early_bird");
  });

  it("vrátí 'regular' pro datum po 1.2.2026", () => {
    const feb = new Date("2026-02-10T10:00:00Z");
    const result = getPhaseForTimestamp(feb, mockRules);
    // early_bird i regular mají thresholdDate ≤ 10.2.2026, ale early_bird má nižší priority
    expect(result).toBe("early_bird"); // priority 1 < priority 2
  });

  it("vrátí 'door' pro datum 2.4.2026", () => {
    const doorDate = new Date("2026-04-02T08:00:00Z");
    const result = getPhaseForTimestamp(doorDate, mockRules);
    // Všechna pravidla aktivní, nejnižší priority = 1 (early_bird)
    expect(result).toBe("early_bird");
  });

  it("ignoruje neaktivní pravidla", () => {
    const inactiveRules: PricingRule[] = [
      {
        phase: "early_bird",
        thresholdDate: null,
        priority: 1,
        active: false, // neaktivní
      },
      {
        phase: "regular",
        thresholdDate: null,
        priority: 2,
        active: true,
      },
    ];
    const result = getPhaseForTimestamp(baseDate, inactiveRules);
    expect(result).toBe("regular");
  });

  it("vrátí 'regular' jako fallback při prázdném poli pravidel", () => {
    const result = getPhaseForTimestamp(baseDate, []);
    expect(result).toBe("regular");
  });

  it("vrátí pravidlo bez thresholdDate (thresholdDate = null) jako vždy aktivní", () => {
    const alwaysActiveRules: PricingRule[] = [
      {
        phase: "door",
        thresholdDate: null,
        priority: 1,
        active: true,
      },
    ];
    const result = getPhaseForTimestamp(new Date("2020-01-01"), alwaysActiveRules);
    expect(result).toBe("door");
  });
});

// ===========================================================================
// calculateTrend
// ===========================================================================

describe("calculateTrend", () => {
  it("vrátí +20 % pro 20% nárůst (100 → 120)", () => {
    expect(calculateTrend(120, 100)).toBe(20);
  });

  it("vrátí -5 % pro 5% pokles (100 → 95)", () => {
    expect(calculateTrend(95, 100)).toBe(-5);
  });

  it("vrátí 0 % pro žádnou změnu (100 → 100)", () => {
    expect(calculateTrend(100, 100)).toBe(0);
  });

  it("vrátí 100 % pokud previous = 0 a current > 0", () => {
    expect(calculateTrend(50, 0)).toBe(100);
  });

  it("vrátí 0 % pokud oba jsou 0", () => {
    expect(calculateTrend(0, 0)).toBe(0);
  });

  it("zaokrouhluje na 1 desetinné místo", () => {
    // 100 → 133.333... = +33.3 %
    expect(calculateTrend(133.333, 100)).toBe(33.3);
  });

  it("vrátí záporné číslo pro pokles", () => {
    expect(calculateTrend(0, 100)).toBe(-100);
  });

  it("správně počítá pro velké hodnoty", () => {
    expect(calculateTrend(1_500_000, 1_000_000)).toBe(50);
  });
});

// ===========================================================================
// buildZoneCapacity (integrační test utility)
// ===========================================================================

describe("buildZoneCapacity", () => {
  it("správně sestaví ZoneCapacity objekt", () => {
    const zone = buildZoneCapacity({
      zone: "VIP",
      section: "A",
      totalSeats: 100,
      soldSeats: 70,
      lockedSeats: 5,
    });

    expect(zone.zone).toBe("VIP");
    expect(zone.section).toBe("A");
    expect(zone.totalSeats).toBe(100);
    expect(zone.soldSeats).toBe(70);
    expect(zone.lockedSeats).toBe(5);
    expect(zone.availableSeats).toBe(25);
    expect(zone.fillPercent).toBe(75); // (70+5)/100 = 75
  });

  it("availableSeats nikdy není záporné (oversold)", () => {
    const zone = buildZoneCapacity({
      zone: "GA",
      section: null,
      totalSeats: 50,
      soldSeats: 55,
      lockedSeats: 0,
    });
    expect(zone.availableSeats).toBe(0);
    expect(zone.fillPercent).toBe(100);
  });
});
