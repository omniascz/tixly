import { describe, it, expect } from "vitest";
import { applyBusinessRules } from "./business-rules";
import {
  BusinessRulesContext,
  EventFeatures,
  ExplanationKey,
  RankedCandidate,
  ScoringComponents,
} from "../types/recommendation.types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEventFeatures(overrides: Partial<EventFeatures> = {}): EventFeatures {
  return {
    eventId: "evt-1",
    category: "rock",
    venueCity: "Praha",
    organizerId: "org-1",
    organizerName: "Test Org",
    sellThroughRate: 0.5,
    salesVelocity24h: 20,
    basePriceMinCzk: 500,
    daysUntilEvent: 14,
    isWeekend: false,
    daysSinceCreation: 10,
    totalCapacity: 1000,
    updatedAt: new Date(),
    ...overrides,
  };
}

const defaultComponents: ScoringComponents = {
  popularityScore: 0.6,
  genreSimilarity: 0.5,
  locationBonus: 1,
  recencyBoost: 0.4,
  priceMatch: 0.7,
  explorationBonus: 0,
};

function makeCandidate(
  eventOverrides: Partial<EventFeatures> = {},
  finalScore = 0.6,
  rank = 1,
): RankedCandidate {
  return {
    eventFeatures: makeEventFeatures(eventOverrides),
    scoringComponents: defaultComponents,
    rawScore: finalScore,
    finalScore,
    explanationKey: ExplanationKey.PopularInCity,
    explanationParams: { city: "Praha" },
    rank,
  };
}

const defaultContext: BusinessRulesContext = {
  purchasedEventIds: new Set(),
  activePassOrganizerIds: [],
  diversityMaxPerCategory: 3,
  diversityTopN: 10,
};

// ─── Rule 1: Sold-out filter ──────────────────────────────────────────────────

describe("Rule 1: sold-out filter", () => {
  it("removes events with sell_through_rate === 1.0", () => {
    const candidates = [
      makeCandidate({ eventId: "evt-1", sellThroughRate: 0.5 }, 0.8, 1),
      makeCandidate({ eventId: "evt-2", sellThroughRate: 1.0 }, 0.7, 2),
      makeCandidate({ eventId: "evt-3", sellThroughRate: 0.3 }, 0.6, 3),
    ];
    const result = applyBusinessRules(candidates, defaultContext);
    const ids = result.map((c) => c.eventFeatures.eventId);
    expect(ids).not.toContain("evt-2");
    expect(ids).toContain("evt-1");
    expect(ids).toContain("evt-3");
  });

  it("removes events with sell_through_rate > 1.0", () => {
    const candidates = [makeCandidate({ eventId: "evt-1", sellThroughRate: 1.2 })];
    const result = applyBusinessRules(candidates, defaultContext);
    expect(result).toHaveLength(0);
  });

  it("keeps events with sell_through_rate just below 1.0", () => {
    const candidates = [makeCandidate({ eventId: "evt-1", sellThroughRate: 0.99 })];
    const result = applyBusinessRules(candidates, defaultContext);
    expect(result).toHaveLength(1);
  });
});

// ─── Rule 2: Past events filter ───────────────────────────────────────────────

describe("Rule 2: past events filter", () => {
  it("removes events with daysUntilEvent < 0", () => {
    const candidates = [
      makeCandidate({ eventId: "evt-1", daysUntilEvent: 5 }, 0.8, 1),
      makeCandidate({ eventId: "evt-2", daysUntilEvent: -1 }, 0.7, 2),
    ];
    const result = applyBusinessRules(candidates, defaultContext);
    expect(result.map((c) => c.eventFeatures.eventId)).toEqual(["evt-1"]);
  });

  it("keeps events happening today (daysUntilEvent === 0)", () => {
    const candidates = [makeCandidate({ eventId: "evt-1", daysUntilEvent: 0 })];
    const result = applyBusinessRules(candidates, defaultContext);
    expect(result).toHaveLength(1);
  });

  it("removes multiple past events", () => {
    const candidates = [
      makeCandidate({ eventId: "evt-1", daysUntilEvent: -10 }, 0.9, 1),
      makeCandidate({ eventId: "evt-2", daysUntilEvent: -1 }, 0.8, 2),
      makeCandidate({ eventId: "evt-3", daysUntilEvent: 1 }, 0.7, 3),
    ];
    const result = applyBusinessRules(candidates, defaultContext);
    expect(result).toHaveLength(1);
    expect(result[0].eventFeatures.eventId).toBe("evt-3");
  });
});

// ─── Rule 3: Already-purchased filter ────────────────────────────────────────

describe("Rule 3: already-purchased filter", () => {
  it("removes events the user has already purchased", () => {
    const purchasedEventIds = new Set(["evt-2", "evt-4"]);
    const context = { ...defaultContext, purchasedEventIds };
    const candidates = [
      makeCandidate({ eventId: "evt-1" }, 0.9, 1),
      makeCandidate({ eventId: "evt-2" }, 0.8, 2),
      makeCandidate({ eventId: "evt-3" }, 0.7, 3),
      makeCandidate({ eventId: "evt-4" }, 0.6, 4),
    ];
    const result = applyBusinessRules(candidates, context);
    const ids = result.map((c) => c.eventFeatures.eventId);
    expect(ids).toContain("evt-1");
    expect(ids).toContain("evt-3");
    expect(ids).not.toContain("evt-2");
    expect(ids).not.toContain("evt-4");
  });

  it("keeps all events when purchasedEventIds is empty", () => {
    const candidates = [
      makeCandidate({ eventId: "evt-1" }, 0.9, 1),
      makeCandidate({ eventId: "evt-2" }, 0.8, 2),
    ];
    const result = applyBusinessRules(candidates, defaultContext);
    expect(result).toHaveLength(2);
  });
});

// ─── Rule 4: Diversity enforcement ───────────────────────────────────────────

describe("Rule 4: category diversity", () => {
  it("limits rock events to max 3 in top 10", () => {
    // 4 rock events + 2 pop events
    const candidates = [
      makeCandidate({ eventId: "rock-1", category: "rock" }, 0.9, 1),
      makeCandidate({ eventId: "rock-2", category: "rock" }, 0.85, 2),
      makeCandidate({ eventId: "rock-3", category: "rock" }, 0.80, 3),
      makeCandidate({ eventId: "rock-4", category: "rock" }, 0.75, 4),
      makeCandidate({ eventId: "pop-1", category: "pop" }, 0.70, 5),
      makeCandidate({ eventId: "pop-2", category: "pop" }, 0.65, 6),
    ];
    const result = applyBusinessRules(candidates, defaultContext);
    const rockInTop10 = result
      .filter((c) => c.rank <= 10 && c.eventFeatures.category === "rock");
    expect(rockInTop10.length).toBeLessThanOrEqual(3);
  });

  it("does not discard the 4th rock event — moves it after top N", () => {
    const candidates = [
      makeCandidate({ eventId: "rock-1", category: "rock" }, 0.9, 1),
      makeCandidate({ eventId: "rock-2", category: "rock" }, 0.85, 2),
      makeCandidate({ eventId: "rock-3", category: "rock" }, 0.80, 3),
      makeCandidate({ eventId: "rock-4", category: "rock" }, 0.75, 4),
    ];
    const result = applyBusinessRules(candidates, defaultContext);
    const ids = result.map((c) => c.eventFeatures.eventId);
    expect(ids).toContain("rock-4");
    // rock-4 must come after rock-1, rock-2, rock-3
    expect(ids.indexOf("rock-4")).toBeGreaterThan(ids.indexOf("rock-3"));
  });

  it("allows all events when diversity limit not reached", () => {
    const candidates = [
      makeCandidate({ eventId: "rock-1", category: "rock" }, 0.9, 1),
      makeCandidate({ eventId: "rock-2", category: "rock" }, 0.8, 2),
      makeCandidate({ eventId: "pop-1", category: "pop" }, 0.7, 3),
    ];
    const result = applyBusinessRules(candidates, defaultContext);
    expect(result).toHaveLength(3);
  });
});

// ─── Rule 5: Season pass boost ────────────────────────────────────────────────

describe("Rule 5: season pass boost", () => {
  it("boosts score × 1.3 for events from pass organizer", () => {
    const context = { ...defaultContext, activePassOrganizerIds: ["org-pass"] };
    const candidates = [
      makeCandidate({ eventId: "evt-boost", organizerId: "org-pass" }, 0.5, 1),
      makeCandidate({ eventId: "evt-normal", organizerId: "org-other" }, 0.6, 2),
    ];
    const result = applyBusinessRules(candidates, context);
    const boosted = result.find((c) => c.eventFeatures.eventId === "evt-boost");
    // 0.5 × 1.3 = 0.65 — should be clamped to max 1.0
    expect(boosted!.finalScore).toBeCloseTo(0.65);
  });

  it("caps boosted score at 1.0", () => {
    const context = { ...defaultContext, activePassOrganizerIds: ["org-pass"] };
    const candidates = [
      makeCandidate({ eventId: "evt-boost", organizerId: "org-pass" }, 0.9, 1),
    ];
    const result = applyBusinessRules(candidates, context);
    expect(result[0].finalScore).toBeLessThanOrEqual(1.0);
  });

  it("changes explanationKey to organizer_pass for boosted events", () => {
    const context = { ...defaultContext, activePassOrganizerIds: ["org-pass"] };
    const candidates = [
      makeCandidate({ eventId: "evt-boost", organizerId: "org-pass", organizerName: "My Org" }, 0.5, 1),
    ];
    const result = applyBusinessRules(candidates, context);
    expect(result[0].explanationKey).toBe(ExplanationKey.OrganizerPass);
    expect(result[0].explanationParams.organizerName).toBe("My Org");
  });

  it("re-ranks events after boost (boosted event moves up)", () => {
    const context = { ...defaultContext, activePassOrganizerIds: ["org-pass"] };
    const candidates = [
      makeCandidate({ eventId: "evt-high", organizerId: "org-other" }, 0.8, 1),
      makeCandidate({ eventId: "evt-boosted", organizerId: "org-pass" }, 0.7, 2),
    ];
    // After boost: evt-boosted = 0.7 × 1.3 = 0.91 > 0.8
    const result = applyBusinessRules(candidates, context);
    expect(result[0].eventFeatures.eventId).toBe("evt-boosted");
    expect(result[0].rank).toBe(1);
  });

  it("does not boost events from non-pass organizers", () => {
    const context = { ...defaultContext, activePassOrganizerIds: ["org-pass"] };
    const candidates = [
      makeCandidate({ eventId: "evt-normal", organizerId: "org-other" }, 0.6, 1),
    ];
    const result = applyBusinessRules(candidates, context);
    expect(result[0].finalScore).toBeCloseTo(0.6);
  });
});

// ─── Rank reassignment ────────────────────────────────────────────────────────

describe("rank reassignment", () => {
  it("assigns contiguous ranks starting from 1 after filtering", () => {
    const purchasedEventIds = new Set(["evt-2"]);
    const context = { ...defaultContext, purchasedEventIds };
    const candidates = [
      makeCandidate({ eventId: "evt-1" }, 0.9, 1),
      makeCandidate({ eventId: "evt-2" }, 0.8, 2),
      makeCandidate({ eventId: "evt-3" }, 0.7, 3),
    ];
    const result = applyBusinessRules(candidates, context);
    expect(result.map((c) => c.rank)).toEqual([1, 2]);
  });

  it("ordering is maintained after rules applied", () => {
    const candidates = [
      makeCandidate({ eventId: "evt-a" }, 0.9, 1),
      makeCandidate({ eventId: "evt-b" }, 0.8, 2),
      makeCandidate({ eventId: "evt-c" }, 0.7, 3),
    ];
    const result = applyBusinessRules(candidates, defaultContext);
    expect(result[0].eventFeatures.eventId).toBe("evt-a");
    expect(result[1].eventFeatures.eventId).toBe("evt-b");
    expect(result[2].eventFeatures.eventId).toBe("evt-c");
  });
});

// ─── Combined rules ───────────────────────────────────────────────────────────

describe("combined rules", () => {
  it("applies all 5 rules in correct order and returns clean result", () => {
    const context: BusinessRulesContext = {
      purchasedEventIds: new Set(["evt-purchased"]),
      activePassOrganizerIds: ["org-pass"],
      diversityMaxPerCategory: 2,
      diversityTopN: 10,
    };

    const candidates: RankedCandidate[] = [
      // Sold-out — filtered by rule 1
      makeCandidate({ eventId: "evt-soldout", sellThroughRate: 1.0 }, 0.95, 1),
      // Past event — filtered by rule 2
      makeCandidate({ eventId: "evt-past", daysUntilEvent: -2 }, 0.90, 2),
      // Already purchased — filtered by rule 3
      makeCandidate({ eventId: "evt-purchased" }, 0.85, 3),
      // Season pass boost → should jump to rank 1
      makeCandidate({ eventId: "evt-pass-boost", organizerId: "org-pass" }, 0.60, 4),
      // Normal event A (rock)
      makeCandidate({ eventId: "evt-rock-1", category: "rock" }, 0.80, 5),
      // Normal event B (rock) — will exceed diversity limit
      makeCandidate({ eventId: "evt-rock-2", category: "rock" }, 0.75, 6),
      // Third rock — hits max 2 limit, deferred
      makeCandidate({ eventId: "evt-rock-3", category: "rock" }, 0.70, 7),
      // Pop event
      makeCandidate({ eventId: "evt-pop-1", category: "pop" }, 0.65, 8),
    ];

    const result = applyBusinessRules(candidates, context);
    const ids = result.map((c) => c.eventFeatures.eventId);

    expect(ids).not.toContain("evt-soldout");
    expect(ids).not.toContain("evt-past");
    expect(ids).not.toContain("evt-purchased");
    expect(ids).toContain("evt-pass-boost");
    expect(ids).toContain("evt-pop-1");

    // Pass boost event should be rank 1 (0.60 × 1.3 = 0.78 > 0.80? No, rock-1 = 0.80)
    // Actually 0.78 < 0.80, so rock-1 stays first
    const passEntry = result.find((c) => c.eventFeatures.eventId === "evt-pass-boost")!;
    expect(passEntry.explanationKey).toBe(ExplanationKey.OrganizerPass);

    // Diversity: rock is capped at 2 in top 10 (diversityMaxPerCategory=2)
    const rockInTop10 = result.filter(
      (c) => c.rank <= 10 && c.eventFeatures.category === "rock",
    );
    expect(rockInTop10.length).toBeLessThanOrEqual(2);
  });
});
