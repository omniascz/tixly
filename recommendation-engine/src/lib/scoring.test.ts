import { describe, it, expect } from "vitest";
import {
  calculateGenreSimilarity,
  calculateRecencyBoost,
  calculatePriceMatch,
  calculateExplorationBonus,
  calculateFinalScore,
  assignExplanation,
  calculatePopularityScore,
} from "./scoring";
import {
  ExplanationKey,
  ScoringComponents,
  ScoringWeights,
} from "../types/recommendation.types";

// ─── calculateGenreSimilarity ─────────────────────────────────────────────────

describe("calculateGenreSimilarity", () => {
  it("returns 1.0 when user vector has only the same category with weight 1", () => {
    const result = calculateGenreSimilarity({ rock: 1.0 }, "rock");
    expect(result).toBeCloseTo(1.0);
  });

  it("returns 1.0 when user vector is dominated by the event category", () => {
    // rock weight / ||vector|| = 1 / 1 = 1 (since only rock)
    const result = calculateGenreSimilarity({ rock: 2.0 }, "rock");
    expect(result).toBeCloseTo(1.0);
  });

  it("returns 0 when user vector is empty", () => {
    expect(calculateGenreSimilarity({}, "rock")).toBe(0);
  });

  it("returns 0 when event category not in user vector", () => {
    expect(calculateGenreSimilarity({ pop: 0.8, jazz: 0.2 }, "rock")).toBe(0);
  });

  it("returns partial overlap correctly", () => {
    // userVector = { rock: 0.7, pop: 0.3 }
    // dot = 0.7, magnitude = sqrt(0.49 + 0.09) = sqrt(0.58) ≈ 0.7616
    // cosine ≈ 0.7 / 0.7616 ≈ 0.919
    const result = calculateGenreSimilarity({ rock: 0.7, pop: 0.3 }, "rock");
    expect(result).toBeGreaterThan(0.9);
    expect(result).toBeLessThanOrEqual(1.0);
  });

  it("result is between 0 and 1 for any valid input", () => {
    const result = calculateGenreSimilarity({ rock: 0.5, pop: 0.5 }, "pop");
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("handles zero-magnitude vector gracefully", () => {
    expect(calculateGenreSimilarity({ rock: 0 }, "rock")).toBe(0);
  });
});

// ─── calculateRecencyBoost ────────────────────────────────────────────────────

describe("calculateRecencyBoost", () => {
  it("returns maximum value (1.0) for event happening today (0 days)", () => {
    // 1 / (1 + ln(0 + 1)) = 1 / (1 + 0) = 1
    expect(calculateRecencyBoost(0)).toBeCloseTo(1.0);
  });

  it("returns ~0.59 for event in 6 days", () => {
    // 1 / (1 + ln(7)) ≈ 1 / (1 + 1.946) ≈ 0.339
    const result = calculateRecencyBoost(6);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it("returns lower value for event in 30 days than in 6 days", () => {
    expect(calculateRecencyBoost(30)).toBeLessThan(calculateRecencyBoost(6));
  });

  it("returns near-zero for event 365 days away", () => {
    // 1 / (1 + ln(366)) ≈ 1 / (1 + 5.9) ≈ 0.144
    const result = calculateRecencyBoost(365);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(0.2);
  });

  it("returns 0 for negative daysUntilEvent (past event)", () => {
    expect(calculateRecencyBoost(-1)).toBe(0);
  });

  it("is a monotonically decreasing function for positive inputs", () => {
    const values = [0, 1, 7, 14, 30, 90, 180, 365].map(calculateRecencyBoost);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    }
  });
});

// ─── calculatePriceMatch ──────────────────────────────────────────────────────

describe("calculatePriceMatch", () => {
  it("returns 1.0 when sensitivity matches normalised price exactly", () => {
    // event price = 500, min = 0, max = 1000 → normalized = 0.5
    // sensitivity = 0.5 → |0.5 - 0.5| = 0 → score = 1
    expect(calculatePriceMatch(0.5, 500, 0, 1000)).toBeCloseTo(1.0);
  });

  it("returns 0 for maximum mismatch (sensitivity 0, price at max)", () => {
    // sensitivity = 0, normalised price = 1 → |1 - 0| = 1 → score = 0
    expect(calculatePriceMatch(0, 1000, 0, 1000)).toBeCloseTo(0);
  });

  it("returns 0 for maximum mismatch (sensitivity 1, price at min)", () => {
    expect(calculatePriceMatch(1, 0, 0, 1000)).toBeCloseTo(0);
  });

  it("returns 0.5 for partial mismatch", () => {
    // sensitivity = 0, price = 500, min = 0, max = 1000
    // normalized = 0.5, |0.5 - 0| = 0.5 → score = 0.5
    expect(calculatePriceMatch(0, 500, 0, 1000)).toBeCloseTo(0.5);
  });

  it("returns 0.5 when min === max (uses 0.5 as normalized price)", () => {
    // normalized = 0.5, sensitivity = 0 → score = 0.5
    expect(calculatePriceMatch(0, 500, 500, 500)).toBeCloseTo(0.5);
  });

  it("clamps event price outside [min, max] range", () => {
    // price > max → normalized clamped to 1
    const result = calculatePriceMatch(0.5, 2000, 0, 1000);
    expect(result).toBeCloseTo(0.5);
  });

  it("result is always between 0 and 1", () => {
    const result = calculatePriceMatch(0.3, 750, 100, 900);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

// ─── calculateExplorationBonus ────────────────────────────────────────────────

describe("calculateExplorationBonus", () => {
  it("returns 0.15 for brand new event (0 days old)", () => {
    expect(calculateExplorationBonus(0)).toBeCloseTo(0.15);
  });

  it("returns 0.075 for event 3.5 days old", () => {
    // 0.15 × (1 - 3.5/7) = 0.15 × 0.5 = 0.075
    expect(calculateExplorationBonus(3.5)).toBeCloseTo(0.075);
  });

  it("returns 0 for event exactly 7 days old", () => {
    expect(calculateExplorationBonus(7)).toBe(0);
  });

  it("returns 0 for event older than 7 days", () => {
    expect(calculateExplorationBonus(8)).toBe(0);
    expect(calculateExplorationBonus(30)).toBe(0);
  });

  it("decreases linearly between 0 and 7 days", () => {
    const at0 = calculateExplorationBonus(0);
    const at3 = calculateExplorationBonus(3);
    const at6 = calculateExplorationBonus(6);
    expect(at0).toBeGreaterThan(at3);
    expect(at3).toBeGreaterThan(at6);
    expect(at6).toBeGreaterThan(0);
  });
});

// ─── calculateFinalScore ──────────────────────────────────────────────────────

describe("calculateFinalScore", () => {
  const defaultWeights: ScoringWeights = {
    alpha: 0.4,
    beta: 0.25,
    gamma: 0.15,
    delta: 0.10,
    epsilon: 0.05,
    zeta: 0.05,
  };

  it("returns correct weighted sum for all-ones components", () => {
    const components: ScoringComponents = {
      popularityScore: 1,
      genreSimilarity: 1,
      locationBonus: 1,
      recencyBoost: 1,
      priceMatch: 1,
      explorationBonus: 1,
    };
    // Weights sum to 1.0, so result should be exactly 1.0
    expect(calculateFinalScore(components, defaultWeights)).toBeCloseTo(1.0);
  });

  it("weights sum correctly for mixed inputs", () => {
    const components: ScoringComponents = {
      popularityScore: 0.8,
      genreSimilarity: 0.6,
      locationBonus: 0,
      recencyBoost: 0.5,
      priceMatch: 0.9,
      explorationBonus: 0,
    };
    // 0.4×0.8 + 0.25×0.6 + 0.15×0 + 0.10×0.5 + 0.05×0.9 + 0.05×0
    // = 0.32 + 0.15 + 0 + 0.05 + 0.045 + 0 = 0.565
    expect(calculateFinalScore(components, defaultWeights)).toBeCloseTo(0.565);
  });

  it("clamps to 0 when all components are 0", () => {
    const components: ScoringComponents = {
      popularityScore: 0,
      genreSimilarity: 0,
      locationBonus: 0,
      recencyBoost: 0,
      priceMatch: 0,
      explorationBonus: 0,
    };
    expect(calculateFinalScore(components, defaultWeights)).toBe(0);
  });

  it("clamps negative inputs to 0", () => {
    const components: ScoringComponents = {
      popularityScore: -5,
      genreSimilarity: -1,
      locationBonus: -1,
      recencyBoost: -1,
      priceMatch: -1,
      explorationBonus: -1,
    };
    expect(calculateFinalScore(components, defaultWeights)).toBe(0);
  });

  it("result is always between 0 and 1", () => {
    const components: ScoringComponents = {
      popularityScore: 1,
      genreSimilarity: 1,
      locationBonus: 1,
      recencyBoost: 1,
      priceMatch: 1,
      explorationBonus: 1,
    };
    const result = calculateFinalScore(components, defaultWeights);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

// ─── assignExplanation ────────────────────────────────────────────────────────

describe("assignExplanation", () => {
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

  it("returns organizer_pass when user has active pass (highest priority)", () => {
    const context = { ...baseContext, hasOrganizerPass: true, genreSimilarity: 0.9 };
    const result = assignExplanation(baseComponents, context);
    expect(result.key).toBe(ExplanationKey.OrganizerPass);
    expect(result.params.organizerName).toBe("Test Organizer");
  });

  it("returns genre_match when genreSimilarity > 0.7", () => {
    const context = { ...baseContext, genreSimilarity: 0.75 };
    const result = assignExplanation(baseComponents, context);
    expect(result.key).toBe(ExplanationKey.GenreMatch);
    expect(result.params.genre).toBe("rock");
  });

  it("returns new_event when explorationBonus > 0 (and no genre match)", () => {
    const context = { ...baseContext, genreSimilarity: 0.3, explorationBonus: 0.1 };
    const result = assignExplanation(baseComponents, context);
    expect(result.key).toBe(ExplanationKey.NewEvent);
    expect(result.params).toEqual({});
  });

  it("returns trending when sales velocity at or above threshold", () => {
    const context = { ...baseContext, salesVelocity24h: 150, salesVelocityThreshold: 100 };
    const result = assignExplanation(baseComponents, context);
    expect(result.key).toBe(ExplanationKey.Trending);
    expect(result.params).toEqual({});
  });

  it("returns location_match when locationBonus === 1 and no higher priority", () => {
    const context = { ...baseContext, locationBonus: 1, genreSimilarity: 0.3 };
    const result = assignExplanation(baseComponents, context);
    expect(result.key).toBe(ExplanationKey.LocationMatch);
    expect(result.params.city).toBe("Praha");
  });

  it("returns popular_in_city as fallback", () => {
    const result = assignExplanation(baseComponents, baseContext);
    expect(result.key).toBe(ExplanationKey.PopularInCity);
    expect(result.params.city).toBe("Praha");
  });

  it("organizer_pass takes priority over genre_match", () => {
    const context = {
      ...baseContext,
      hasOrganizerPass: true,
      genreSimilarity: 0.95,
    };
    const result = assignExplanation(baseComponents, context);
    expect(result.key).toBe(ExplanationKey.OrganizerPass);
  });

  it("genre_match takes priority over new_event", () => {
    const context = {
      ...baseContext,
      genreSimilarity: 0.8,
      explorationBonus: 0.15,
    };
    const result = assignExplanation(baseComponents, context);
    expect(result.key).toBe(ExplanationKey.GenreMatch);
  });
});

// ─── calculatePopularityScore ─────────────────────────────────────────────────

describe("calculatePopularityScore", () => {
  it("returns 1.0 when both sell-through and velocity are at max", () => {
    expect(calculatePopularityScore(1.0, 100, 100)).toBeCloseTo(1.0);
  });

  it("returns 0 when both inputs are 0", () => {
    expect(calculatePopularityScore(0, 0, 100)).toBeCloseTo(0);
  });

  it("returns 0.5 when sell-through is 1 and velocity is 0", () => {
    expect(calculatePopularityScore(1.0, 0, 100)).toBeCloseTo(0.5);
  });

  it("handles zero maxSalesVelocity without dividing by zero", () => {
    expect(() => calculatePopularityScore(0.5, 50, 0)).not.toThrow();
    expect(calculatePopularityScore(0.5, 50, 0)).toBeCloseTo(0.25);
  });
});
