import { describe, it, expect } from "vitest";
import {
  calculateGenreSimilarity,
  calculateRecencyBoost,
  calculatePriceMatch,
  calculateExplorationBonus,
  calculateFinalScore,
  assignExplanation,
} from "./scoring";
import {
  ExplanationKey,
  ScoringComponents,
  ScoringWeights,
} from "../types/recommendation.types";

// ─── Extended tests: calculateGenreSimilarity ─────────────────────────────────

describe("calculateGenreSimilarity — extended edge cases", () => {
  it("handles multi-category genre vector (rock: 0.6, pop: 0.4)", () => {
    const result = calculateGenreSimilarity({ rock: 0.6, pop: 0.4 }, "rock");
    // dot = 0.6, magnitude = sqrt(0.36 + 0.16) = sqrt(0.52) ≈ 0.7211
    // cosine = 0.6 / 0.7211 ≈ 0.832
    expect(result).toBeGreaterThan(0.82);
    expect(result).toBeLessThan(0.84);
  });

  it("returns 0 when event category is not in genre vector", () => {
    expect(calculateGenreSimilarity({ rock: 0.7, pop: 0.3 }, "jazz")).toBe(0);
  });

  it("handles event category not in vector with multiple categories", () => {
    const vector = { rock: 0.5, pop: 0.3, metal: 0.2 };
    expect(calculateGenreSimilarity(vector, "classical")).toBe(0);
  });

  it("returns 0 for completely empty genre vector", () => {
    expect(calculateGenreSimilarity({}, "rock")).toBe(0);
  });

  it("handles very small magnitude values (0.001 range)", () => {
    const result = calculateGenreSimilarity({ rock: 0.001, pop: 0.0005 }, "rock");
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("returns 1.0 for single-category vector when event matches", () => {
    const result = calculateGenreSimilarity({ rock: 1.0 }, "rock");
    expect(result).toBeCloseTo(1.0);
  });

  it("handles vector with many categories at equal weights", () => {
    const vector = { rock: 0.2, pop: 0.2, jazz: 0.2, metal: 0.2, classical: 0.2 };
    const result = calculateGenreSimilarity(vector, "rock");
    // dot = 0.2, magnitude = sqrt(5 * 0.04) = sqrt(0.2) ≈ 0.447
    // cosine = 0.2 / 0.447 ≈ 0.447
    expect(result).toBeGreaterThan(0.44);
    expect(result).toBeLessThan(0.46);
  });

  it("clamps result to exactly 1.0 when magnitude is equal to dot product", () => {
    // This shouldn't happen in normal data, but test the clamp
    const result = calculateGenreSimilarity({ rock: 1.0 }, "rock");
    expect(result).toBeLessThanOrEqual(1);
  });
});

// ─── Extended tests: calculateRecencyBoost ─────────────────────────────────────

describe("calculateRecencyBoost — extended edge cases", () => {
  it("returns 0 for negative daysUntilEvent (event in past)", () => {
    expect(calculateRecencyBoost(-1)).toBe(0);
    expect(calculateRecencyBoost(-100)).toBe(0);
  });

  it("returns exactly 1.0 for event happening today (0 days)", () => {
    const result = calculateRecencyBoost(0);
    expect(result).toBeCloseTo(1.0);
  });

  it("returns lower value for 730 days (2 years) than for 365 days", () => {
    const onceYear = calculateRecencyBoost(365);
    const twoYears = calculateRecencyBoost(730);
    expect(twoYears).toBeLessThan(onceYear);
  });

  it("handles very large daysUntilEvent (10000)", () => {
    const result = calculateRecencyBoost(10000);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(0.1);
  });

  it("is monotonic: each step increases days → decreases boost", () => {
    const days = [0, 1, 7, 14, 30, 60, 90, 180, 365];
    const boosts = days.map(calculateRecencyBoost);
    for (let i = 1; i < boosts.length; i++) {
      expect(boosts[i]).toBeLessThanOrEqual(boosts[i - 1]!);
    }
  });

  it("returns value very close to 0 for 1000+ days", () => {
    expect(calculateRecencyBoost(1000)).toBeLessThan(0.1);
  });
});

// ─── Extended tests: calculatePriceMatch ────────────────────────────────────────

describe("calculatePriceMatch — extended edge cases", () => {
  it("handles minPrice === maxPrice case (division by zero protection)", () => {
    // When min === max, normalized is set to 0.5
    const result = calculatePriceMatch(0.5, 500, 500, 500);
    expect(result).toBeCloseTo(1.0);
  });

  it("handles minPrice === maxPrice with sensitivity 0", () => {
    // normalized = 0.5, |0.5 - 0| = 0.5, score = 0.5
    expect(calculatePriceMatch(0, 500, 500, 500)).toBeCloseTo(0.5);
  });

  it("clamps price outside range (price > maxPrice)", () => {
    // price = 2000, min = 0, max = 1000
    // normalized = 2000/1000 = 2 → clamped to 1
    // sensitivity = 0.5, |1 - 0.5| = 0.5 → score = 0.5
    expect(calculatePriceMatch(0.5, 2000, 0, 1000)).toBeCloseTo(0.5);
  });

  it("clamps price below minPrice", () => {
    // price = -100, min = 0, max = 1000
    // normalized = -100/1000 = -0.1 → clamped to 0
    // sensitivity = 0.5, |0 - 0.5| = 0.5 → score = 0.5
    expect(calculatePriceMatch(0.5, -100, 0, 1000)).toBeCloseTo(0.5);
  });

  it("handles price_sensitivity = 0 (insensitive to price)", () => {
    // sensitivity = 0 (user only cares about low prices)
    // price at max (normalized = 1), |1 - 0| = 1 → score = 0
    expect(calculatePriceMatch(0, 1000, 0, 1000)).toBeCloseTo(0);
  });

  it("handles price_sensitivity = 1 (sensitive to high prices)", () => {
    // sensitivity = 1 (user wants expensive events)
    // price at min (normalized = 0), |0 - 1| = 1 → score = 0
    expect(calculatePriceMatch(1, 0, 0, 1000)).toBeCloseTo(0);
  });

  it("handles very small price range", () => {
    // min = 1, max = 2, price = 1.5
    // normalized = 0.5, sensitivity = 0.5, |0.5 - 0.5| = 0 → score = 1
    expect(calculatePriceMatch(0.5, 1.5, 1, 2)).toBeCloseTo(1.0);
  });

  it("result is always in [0, 1]", () => {
    const testCases = [
      [0, 500, 100, 900],
      [1, 50, 0, 10000],
      [0.5, 999, 500, 1000],
    ];
    for (const [sensitivity, price, min, max] of testCases) {
      const result = calculatePriceMatch(sensitivity, price, min, max);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Extended tests: calculateExplorationBonus ──────────────────────────────────

describe("calculateExplorationBonus — extended edge cases", () => {
  it("returns exactly 0 for event exactly 7 days old", () => {
    expect(calculateExplorationBonus(7)).toBe(0);
  });

  it("returns exactly 0 for event older than 7 days", () => {
    expect(calculateExplorationBonus(7.1)).toBe(0);
    expect(calculateExplorationBonus(100)).toBe(0);
  });

  it("returns exactly 0.15 for brand new event (0 days)", () => {
    expect(calculateExplorationBonus(0)).toBeCloseTo(0.15);
  });

  it("handles negative daysSinceCreation (clamps to 0.15)", () => {
    // According to implementation: if (daysSinceCreation < 0) return 0.15
    expect(calculateExplorationBonus(-1)).toBe(0.15);
    expect(calculateExplorationBonus(-100)).toBe(0.15);
  });

  it("decreases linearly from 0.15 to 0 over 0-7 days", () => {
    const at0 = calculateExplorationBonus(0);
    const at3 = calculateExplorationBonus(3);
    const at7 = calculateExplorationBonus(7);

    expect(at0).toBeCloseTo(0.15);
    expect(at3).toBeCloseTo(0.075);
    expect(at7).toBeCloseTo(0);
  });

  it("returns 0.15 × (1 - 1/7) for 1 day old", () => {
    // 0.15 × (1 - 1/7) = 0.15 × 6/7 ≈ 0.1286
    expect(calculateExplorationBonus(1)).toBeCloseTo(0.15 * (6 / 7));
  });

  it("handles fractional days", () => {
    const result = calculateExplorationBonus(3.5);
    expect(result).toBeCloseTo(0.15 * (1 - 3.5 / 7));
  });
});

// ─── Extended tests: calculateFinalScore ────────────────────────────────────────

describe("calculateFinalScore — extended edge cases", () => {
  const baseWeights: ScoringWeights = {
    alpha: 0.4,
    beta: 0.25,
    gamma: 0.15,
    delta: 0.1,
    epsilon: 0.05,
    zeta: 0.05,
  };

  it("all components = 0 → score = 0", () => {
    const components: ScoringComponents = {
      popularityScore: 0,
      genreSimilarity: 0,
      locationBonus: 0,
      recencyBoost: 0,
      priceMatch: 0,
      explorationBonus: 0,
    };
    expect(calculateFinalScore(components, baseWeights)).toBe(0);
  });

  it("all components = 1, weights sum = 1 → score = 1", () => {
    const components: ScoringComponents = {
      popularityScore: 1,
      genreSimilarity: 1,
      locationBonus: 1,
      recencyBoost: 1,
      priceMatch: 1,
      explorationBonus: 1,
    };
    // weights sum = 1.0
    expect(calculateFinalScore(components, baseWeights)).toBeCloseTo(1.0);
  });

  it("handles weights that don't sum to 1.0 (model is robust)", () => {
    const weights: ScoringWeights = {
      alpha: 0.5,
      beta: 0.5,
      gamma: 0,
      delta: 0,
      epsilon: 0,
      zeta: 0,
    };
    const components: ScoringComponents = {
      popularityScore: 1,
      genreSimilarity: 1,
      locationBonus: 1,
      recencyBoost: 1,
      priceMatch: 1,
      explorationBonus: 1,
    };
    // Raw = 0.5 + 0.5 = 1.0
    expect(calculateFinalScore(components, weights)).toBeCloseTo(1.0);
  });

  it("handles weights that sum to > 1.0, clamped to 1", () => {
    const weights: ScoringWeights = {
      alpha: 0.5,
      beta: 0.5,
      gamma: 0.5,
      delta: 0,
      epsilon: 0,
      zeta: 0,
    };
    const components: ScoringComponents = {
      popularityScore: 1,
      genreSimilarity: 1,
      locationBonus: 1,
      recencyBoost: 1,
      priceMatch: 1,
      explorationBonus: 1,
    };
    // Raw = 1.5 → clamped to 1.0
    expect(calculateFinalScore(components, weights)).toBe(1.0);
  });

  it("clamps negative raw score to 0", () => {
    const weights: ScoringWeights = {
      alpha: -1,
      beta: -1,
      gamma: -1,
      delta: 0,
      epsilon: 0,
      zeta: 0,
    };
    const components: ScoringComponents = {
      popularityScore: 1,
      genreSimilarity: 1,
      locationBonus: 1,
      recencyBoost: 1,
      priceMatch: 1,
      explorationBonus: 1,
    };
    // Raw = -3 → clamped to 0
    expect(calculateFinalScore(components, weights)).toBe(0);
  });

  it("single non-zero component contributes proportionally", () => {
    const components: ScoringComponents = {
      popularityScore: 1,
      genreSimilarity: 0,
      locationBonus: 0,
      recencyBoost: 0,
      priceMatch: 0,
      explorationBonus: 0,
    };
    // Raw = 0.4 * 1 = 0.4
    expect(calculateFinalScore(components, baseWeights)).toBeCloseTo(0.4);
  });

  it("result is always in [0, 1]", () => {
    const testCases = [
      {
        popularityScore: 0.5,
        genreSimilarity: 0.7,
        locationBonus: 1,
        recencyBoost: 0.3,
        priceMatch: 0.8,
        explorationBonus: 0.1,
      },
      {
        popularityScore: 1,
        genreSimilarity: 1,
        locationBonus: 1,
        recencyBoost: 1,
        priceMatch: 1,
        explorationBonus: 1,
      },
      {
        popularityScore: 0,
        genreSimilarity: 0,
        locationBonus: 0,
        recencyBoost: 0,
        priceMatch: 0,
        explorationBonus: 0,
      },
    ];
    for (const components of testCases) {
      const result = calculateFinalScore(components, baseWeights);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Extended tests: assignExplanation ──────────────────────────────────────────

describe("assignExplanation — extended edge cases", () => {
  const baseComponents: ScoringComponents = {
    popularityScore: 0.5,
    genreSimilarity: 0.5,
    locationBonus: 0,
    recencyBoost: 0.5,
    priceMatch: 0.5,
    explorationBonus: 0,
  };

  const baseContext = {
    genreSimilarity: 0.5,
    locationBonus: 0,
    salesVelocity24h: 10,
    salesVelocityThreshold: 100,
    explorationBonus: 0,
    hasOrganizerPass: false,
    organizerName: "Test Organizer",
    city: "Praha",
    genre: "rock",
  };

  it("genre_match takes priority over both location and exploration", () => {
    const context = {
      ...baseContext,
      genreSimilarity: 0.75,
      locationBonus: 1,
      explorationBonus: 0.15,
    };
    const result = assignExplanation(baseComponents, context);
    expect(result.key).toBe(ExplanationKey.GenreMatch);
  });

  it("new_event is chosen when exploration_bonus > 0 and genre < 0.7", () => {
    const context = {
      ...baseContext,
      genreSimilarity: 0.6,
      explorationBonus: 0.1,
    };
    const result = assignExplanation(baseComponents, context);
    expect(result.key).toBe(ExplanationKey.NewEvent);
  });

  it("exploration_bonus > 0 with genre >= 0.7 still prefers genre_match", () => {
    const context = {
      ...baseContext,
      genreSimilarity: 0.8,
      explorationBonus: 0.15,
    };
    const result = assignExplanation(baseComponents, context);
    expect(result.key).toBe(ExplanationKey.GenreMatch);
  });

  it("trending is chosen when exploration_bonus = 0 but sales velocity high", () => {
    const context = {
      ...baseContext,
      genreSimilarity: 0.3,
      explorationBonus: 0,
      salesVelocity24h: 150,
    };
    const result = assignExplanation(baseComponents, context);
    expect(result.key).toBe(ExplanationKey.Trending);
  });

  it("location_match chosen when at boundary (genreSimilarity = 0.7 excluded)", () => {
    const context = {
      ...baseContext,
      genreSimilarity: 0.69,
      locationBonus: 1,
    };
    const result = assignExplanation(baseComponents, context);
    expect(result.key).toBe(ExplanationKey.LocationMatch);
  });

  it("returns organizer_pass even when all other signals are high", () => {
    const context = {
      ...baseContext,
      hasOrganizerPass: true,
      genreSimilarity: 0.9,
      explorationBonus: 0.15,
      locationBonus: 1,
      salesVelocity24h: 200,
    };
    const result = assignExplanation(baseComponents, context);
    expect(result.key).toBe(ExplanationKey.OrganizerPass);
  });

  it("params contain correct organizer name for organizer_pass", () => {
    const context = {
      ...baseContext,
      hasOrganizerPass: true,
      organizerName: "Rock Festival 2026",
    };
    const result = assignExplanation(baseComponents, context);
    expect(result.params.organizerName).toBe("Rock Festival 2026");
  });

  it("params contain correct genre for genre_match", () => {
    const context = {
      ...baseContext,
      genreSimilarity: 0.8,
      genre: "metal",
    };
    const result = assignExplanation(baseComponents, context);
    expect(result.params.genre).toBe("metal");
  });

  it("popular_in_city is fallback when no higher priority matches", () => {
    const context = {
      ...baseContext,
      genreSimilarity: 0.3,
      explorationBonus: 0,
      salesVelocity24h: 5,
      locationBonus: 0,
    };
    const result = assignExplanation(baseComponents, context);
    expect(result.key).toBe(ExplanationKey.PopularInCity);
  });

  it("new_event params are empty object", () => {
    const context = {
      ...baseContext,
      genreSimilarity: 0.3,
      explorationBonus: 0.1,
    };
    const result = assignExplanation(baseComponents, context);
    expect(result.key).toBe(ExplanationKey.NewEvent);
    expect(result.params).toEqual({});
  });
});
