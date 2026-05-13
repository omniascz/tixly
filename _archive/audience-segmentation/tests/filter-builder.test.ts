import { describe, expect, it } from "vitest";
import {
  buildWhereClause,
  validateFilter,
} from "../src/lib/filter-builder";
import { InvalidFilterError, SegmentFilter } from "../src/types/segmentation.types";

// ─── buildWhereClause tests ───────────────────────────────────────────────────

describe("buildWhereClause", () => {
  // ── Geographic ──────────────────────────────────────────────────────────

  it("generates city filter with parameterised ANY(ARRAY[...])", () => {
    const filter: SegmentFilter = {
      geographic: { city: ["Praha", "Brno"] },
    };
    const { sql, params } = buildWhereClause(filter);

    expect(sql).toContain("u.city = ANY(ARRAY[");
    expect(sql).toContain("$1");
    expect(sql).toContain("$2");
    expect(params).toEqual(["Praha", "Brno"]);
  });

  it("generates region filter with parameterised ANY", () => {
    const filter: SegmentFilter = {
      geographic: { region: ["Jihomoravský kraj"] },
    };
    const { sql, params } = buildWhereClause(filter);

    expect(sql).toContain("u.region = ANY(ARRAY[$1])");
    expect(params).toEqual(["Jihomoravský kraj"]);
  });

  it("generates country filter", () => {
    const filter: SegmentFilter = {
      geographic: { country: ["CZ", "SK"] },
    };
    const { sql, params } = buildWhereClause(filter);

    expect(sql).toContain("u.country = ANY(ARRAY[");
    expect(params).toContain("CZ");
    expect(params).toContain("SK");
  });

  it("combines city + country with AND", () => {
    const filter: SegmentFilter = {
      geographic: { city: ["Praha"], country: ["CZ"] },
    };
    const { sql, params } = buildWhereClause(filter);

    expect(sql).toContain("AND");
    expect(params).toEqual(["Praha", "CZ"]);
  });

  // ── Behavioral ──────────────────────────────────────────────────────────

  it("generates minPurchases >= condition", () => {
    const filter: SegmentFilter = {
      behavioral: { minPurchases: 3 },
    };
    const { sql, params } = buildWhereClause(filter);

    expect(sql).toContain(">= $1");
    expect(params).toEqual([3]);
  });

  it("generates maxPurchases <= condition", () => {
    const filter: SegmentFilter = {
      behavioral: { maxPurchases: 5 },
    };
    const { sql, params } = buildWhereClause(filter);

    expect(sql).toContain("<= $1");
    expect(params).toEqual([5]);
  });

  it("generates BETWEEN for minPurchases + maxPurchases", () => {
    const filter: SegmentFilter = {
      behavioral: { minPurchases: 2, maxPurchases: 10 },
    };
    const { sql, params } = buildWhereClause(filter);

    expect(sql).toContain("BETWEEN $1 AND $2");
    expect(params).toEqual([2, 10]);
  });

  it("generates firstTimeBuyer = 1 order condition", () => {
    const filter: SegmentFilter = {
      behavioral: { firstTimeBuyer: true },
    };
    const { sql, params } = buildWhereClause(filter);

    expect(sql).toContain(") = 1");
    expect(params).toHaveLength(0);
  });

  it("generates repeatingBuyer > 1 condition", () => {
    const filter: SegmentFilter = {
      behavioral: { repeatingBuyer: true },
    };
    const { sql, params } = buildWhereClause(filter);

    expect(sql).toContain(") > 1");
    expect(params).toHaveLength(0);
  });

  it("generates attendedEventIds EXISTS subquery", () => {
    const filter: SegmentFilter = {
      behavioral: { attendedEventIds: ["evt-1", "evt-2"] },
    };
    const { sql, params } = buildWhereClause(filter);

    expect(sql).toContain("EXISTS");
    expect(sql).toContain("oi.event_id = ANY(ARRAY[");
    expect(params).toEqual(["evt-1", "evt-2"]);
  });

  // ── RFM ────────────────────────────────────────────────────────────────

  it("generates recency condition using INTERVAL", () => {
    const filter: SegmentFilter = {
      rfm: { recencyDays: 30 },
    };
    const { sql, params } = buildWhereClause(filter);

    expect(sql).toContain("INTERVAL '1 day'");
    expect(params).toContain(30);
  });

  it("generates minFrequency COUNT condition", () => {
    const filter: SegmentFilter = {
      rfm: { minFrequency: 5 },
    };
    const { sql, params } = buildWhereClause(filter);

    expect(sql).toContain("COUNT(*)");
    expect(params).toContain(5);
  });

  it("generates minMonetaryValue SUM condition (haléře)", () => {
    const filter: SegmentFilter = {
      rfm: { minMonetaryValue: 50_000 }, // 500 Kč in haléře
    };
    const { sql, params } = buildWhereClause(filter);

    expect(sql).toContain("SUM(o.total)");
    expect(params).toContain(50_000);
  });

  it("combines all three RFM fields correctly", () => {
    const filter: SegmentFilter = {
      rfm: { recencyDays: 60, minFrequency: 3, minMonetaryValue: 100_000 },
    };
    const { sql, params } = buildWhereClause(filter);

    expect(params).toContain(60);
    expect(params).toContain(3);
    expect(params).toContain(100_000);
    // Three separate sub-conditions joined by AND
    expect(sql.split("AND").length).toBeGreaterThanOrEqual(3);
  });

  // ── Loyalty tier ────────────────────────────────────────────────────────

  it("generates loyalty tier ANY condition", () => {
    const filter: SegmentFilter = {
      loyaltyTier: { tiers: ["gold", "platinum"] },
    };
    const { sql, params } = buildWhereClause(filter);

    expect(sql).toContain("la.tier = ANY(ARRAY[");
    expect(params).toContain("gold");
    expect(params).toContain("platinum");
  });

  // ── Cross-filter combining ──────────────────────────────────────────────

  it("combines geographic + rfm filters with sequential param numbering", () => {
    const filter: SegmentFilter = {
      geographic: { country: ["CZ"] },
      rfm: { minFrequency: 2 },
    };
    const { sql, params } = buildWhereClause(filter);

    // CZ should be $1, minFrequency should be $2
    expect(params[0]).toBe("CZ");
    expect(params[1]).toBe(2);
    expect(sql).toContain("$1");
    expect(sql).toContain("$2");
  });

  it("returns TRUE when filter has no active sub-filters (empty geographic)", () => {
    // An empty geographic object produces no conditions
    const filter: SegmentFilter = {
      geographic: {},
      rfm: { minFrequency: 1 },
    };
    const { sql } = buildWhereClause(filter);
    // Should still produce something from RFM
    expect(sql).toContain("COUNT(*)");
  });

  it("never interpolates user values directly into SQL string", () => {
    const maliciousInput = "'; DROP TABLE users; --";
    const filter: SegmentFilter = {
      geographic: { city: [maliciousInput] },
    };
    const { sql, params } = buildWhereClause(filter);

    // The malicious string must NOT appear in the SQL
    expect(sql).not.toContain(maliciousInput);
    // It must be in the params array instead
    expect(params).toContain(maliciousInput);
  });
});

// ─── validateFilter tests ─────────────────────────────────────────────────────

describe("validateFilter", () => {
  it("accepts a valid geographic filter", () => {
    const input = { geographic: { city: ["Praha"] } };
    const result = validateFilter(input);
    expect(result.geographic?.city).toEqual(["Praha"]);
  });

  it("accepts a valid rfm filter", () => {
    const input = { rfm: { recencyDays: 30, minFrequency: 2, minMonetaryValue: 0 } };
    const result = validateFilter(input);
    expect(result.rfm?.recencyDays).toBe(30);
  });

  it("accepts a valid loyalty tier filter", () => {
    const input = { loyaltyTier: { tiers: ["silver", "gold"] } };
    const result = validateFilter(input);
    expect(result.loyaltyTier?.tiers).toEqual(["silver", "gold"]);
  });

  it("throws InvalidFilterError for null input", () => {
    expect(() => validateFilter(null)).toThrow(InvalidFilterError);
  });

  it("throws InvalidFilterError for non-object input", () => {
    expect(() => validateFilter("geographic")).toThrow(InvalidFilterError);
  });

  it("throws InvalidFilterError when filter has no recognized sub-filter", () => {
    expect(() => validateFilter({})).toThrow(InvalidFilterError);
  });

  it("throws InvalidFilterError for invalid city type (not array)", () => {
    expect(() =>
      validateFilter({ geographic: { city: "Praha" } }),
    ).toThrow(InvalidFilterError);
  });

  it("throws InvalidFilterError when minPurchases > maxPurchases", () => {
    expect(() =>
      validateFilter({ behavioral: { minPurchases: 10, maxPurchases: 2 } }),
    ).toThrow(InvalidFilterError);
  });

  it("throws InvalidFilterError for non-integer recencyDays", () => {
    expect(() =>
      validateFilter({ rfm: { recencyDays: 1.5 } }),
    ).toThrow(InvalidFilterError);
  });

  it("throws InvalidFilterError for zero or negative recencyDays", () => {
    expect(() =>
      validateFilter({ rfm: { recencyDays: 0 } }),
    ).toThrow(InvalidFilterError);
  });

  it("throws InvalidFilterError for invalid loyalty tier value", () => {
    expect(() =>
      validateFilter({ loyaltyTier: { tiers: ["diamond"] } }),
    ).toThrow(InvalidFilterError);
  });

  it("throws InvalidFilterError for empty tiers array", () => {
    expect(() =>
      validateFilter({ loyaltyTier: { tiers: [] } }),
    ).toThrow(InvalidFilterError);
  });

  it("throws InvalidFilterError for negative minMonetaryValue", () => {
    expect(() =>
      validateFilter({ rfm: { minMonetaryValue: -100 } }),
    ).toThrow(InvalidFilterError);
  });

  it("accepts a combined geographic + behavioral + rfm + loyaltyTier filter", () => {
    const input = {
      geographic: { country: ["CZ"] },
      behavioral: { minPurchases: 1, repeatingBuyer: true },
      rfm: { recencyDays: 90, minMonetaryValue: 10_000 },
      loyaltyTier: { tiers: ["bronze", "silver"] },
    };
    const result = validateFilter(input);
    expect(result.geographic?.country).toEqual(["CZ"]);
    expect(result.behavioral?.minPurchases).toBe(1);
    expect(result.rfm?.recencyDays).toBe(90);
    expect(result.loyaltyTier?.tiers).toHaveLength(2);
  });
});
