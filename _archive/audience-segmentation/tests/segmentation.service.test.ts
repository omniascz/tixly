import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSegment,
  DbAdapter,
  deleteSegment,
  exportSegment,
  getMembers,
  listSegments,
  refreshSegment,
  ServiceDeps,
} from "../src/services/segmentation.service";
import {
  SegmentFilter,
  SegmentNotFoundError,
} from "../src/types/segmentation.types";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const PROMOTER_ID = "promoter-abc";
const SEGMENT_ID = "seg-001";

const GEO_FILTER: SegmentFilter = {
  geographic: { city: ["Praha"] },
};

const FULL_FILTER: SegmentFilter = {
  geographic: { country: ["CZ"] },
  behavioral: { minPurchases: 2, repeatingBuyer: true },
  rfm: { recencyDays: 60, minMonetaryValue: 50_000 },
  loyaltyTier: { tiers: ["gold"] },
};

const SEGMENT_ROW = {
  id: SEGMENT_ID,
  promoter_id: PROMOTER_ID,
  name: "High-value Prague buyers",
  filter: GEO_FILTER,
  estimated_size: 150,
  created_at: "2026-04-01T10:00:00Z",
  last_refreshed_at: "2026-04-01T10:00:00Z",
};

// ─── DB mock factory ──────────────────────────────────────────────────────────

function makeDb(): DbAdapter & {
  query: ReturnType<typeof vi.fn>;
  queryOne: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  return {
    query: vi.fn(),
    queryOne: vi.fn(),
    execute: vi.fn(),
  };
}

// ─── createSegment ────────────────────────────────────────────────────────────

describe("createSegment", () => {
  it("inserts a segment and returns the row", async () => {
    const db = makeDb();
    // First query: COUNT for estimation
    db.query.mockResolvedValueOnce([{ count: "42" }]);
    // Second query: INSERT RETURNING
    db.query.mockResolvedValueOnce([{ ...SEGMENT_ROW, estimated_size: 42 }]);

    const deps: ServiceDeps = { db };
    const result = await createSegment(deps, PROMOTER_ID, "High-value Prague buyers", GEO_FILTER);

    expect(result.estimatedSize).toBe(42);
    expect(result.promoterId).toBe(PROMOTER_ID);
    expect(result.name).toBe("High-value Prague buyers");
    expect(result.filter).toEqual(GEO_FILTER);
  });

  it("passes the filter as JSON to the INSERT", async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ count: "10" }]);
    db.query.mockResolvedValueOnce([SEGMENT_ROW]);

    const deps: ServiceDeps = { db };
    await createSegment(deps, PROMOTER_ID, "Test", GEO_FILTER);

    // The second call is the INSERT; check JSON.stringify was used
    const insertCall = db.query.mock.calls[1];
    expect(insertCall).toBeDefined();
    const insertParams = insertCall?.[1] as unknown[];
    // Third param is the serialised filter
    expect(typeof insertParams?.[2]).toBe("string");
    expect(JSON.parse(insertParams?.[2] as string)).toEqual(GEO_FILTER);
  });

  it("throws when INSERT returns no row", async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ count: "0" }]);
    db.query.mockResolvedValueOnce([]); // empty result

    const deps: ServiceDeps = { db };
    await expect(
      createSegment(deps, PROMOTER_ID, "Bad segment", GEO_FILTER),
    ).rejects.toThrow("returned no row");
  });

  it("uses estimatedSize=0 when COUNT returns 0", async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ count: "0" }]);
    db.query.mockResolvedValueOnce([{ ...SEGMENT_ROW, estimated_size: 0 }]);

    const deps: ServiceDeps = { db };
    const result = await createSegment(deps, PROMOTER_ID, "Empty segment", GEO_FILTER);
    expect(result.estimatedSize).toBe(0);
  });
});

// ─── refreshSegment ───────────────────────────────────────────────────────────

describe("refreshSegment", () => {
  it("re-computes estimatedSize and returns updated segment", async () => {
    const db = makeDb();
    db.queryOne.mockResolvedValueOnce(SEGMENT_ROW); // fetch existing
    db.query.mockResolvedValueOnce([{ count: "99" }]); // COUNT
    db.query.mockResolvedValueOnce([
      { ...SEGMENT_ROW, estimated_size: 99, last_refreshed_at: "2026-04-05T12:00:00Z" },
    ]); // UPDATE RETURNING

    const deps: ServiceDeps = { db };
    const result = await refreshSegment(deps, SEGMENT_ID, PROMOTER_ID);

    expect(result.estimatedSize).toBe(99);
    expect(result.lastRefreshedAt).toBe("2026-04-05T12:00:00Z");
  });

  it("throws SegmentNotFoundError when segment does not exist", async () => {
    const db = makeDb();
    db.queryOne.mockResolvedValueOnce(null);

    const deps: ServiceDeps = { db };
    await expect(
      refreshSegment(deps, "nonexistent", PROMOTER_ID),
    ).rejects.toThrow(SegmentNotFoundError);
  });

  it("throws SegmentNotFoundError when UPDATE returns no row (race condition)", async () => {
    const db = makeDb();
    db.queryOne.mockResolvedValueOnce(SEGMENT_ROW);
    db.query.mockResolvedValueOnce([{ count: "50" }]);
    db.query.mockResolvedValueOnce([]); // UPDATE returns nothing

    const deps: ServiceDeps = { db };
    await expect(
      refreshSegment(deps, SEGMENT_ID, PROMOTER_ID),
    ).rejects.toThrow(SegmentNotFoundError);
  });
});

// ─── getMembers ───────────────────────────────────────────────────────────────

describe("getMembers", () => {
  it("returns mapped SegmentMember array", async () => {
    const db = makeDb();
    db.queryOne.mockResolvedValueOnce(SEGMENT_ROW);
    db.query.mockResolvedValueOnce([
      { user_id: "u-1", email: "alice@example.com", first_name: "Alice" },
      { user_id: "u-2", email: "bob@example.com", first_name: null },
    ]);

    const deps: ServiceDeps = { db };
    const members = await getMembers(deps, SEGMENT_ID, PROMOTER_ID);

    expect(members).toHaveLength(2);
    expect(members[0]).toEqual({
      userId: "u-1",
      email: "alice@example.com",
      firstName: "Alice",
    });
    expect(members[1]?.firstName).toBeNull();
  });

  it("clamps limit to 1000", async () => {
    const db = makeDb();
    db.queryOne.mockResolvedValueOnce(SEGMENT_ROW);
    db.query.mockResolvedValueOnce([]);

    const deps: ServiceDeps = { db };
    await getMembers(deps, SEGMENT_ID, PROMOTER_ID, 9999, 0);

    // The actual SQL query should have 1000 in params, not 9999
    const queryCall = db.query.mock.calls[0];
    expect(queryCall).toBeDefined();
    const params = queryCall?.[1] as unknown[];
    // limit (1000) should appear in params after filterParams
    expect(params).toContain(1000);
    expect(params).not.toContain(9999);
  });

  it("throws SegmentNotFoundError for unknown segment", async () => {
    const db = makeDb();
    db.queryOne.mockResolvedValueOnce(null);

    const deps: ServiceDeps = { db };
    await expect(
      getMembers(deps, "missing-seg", PROMOTER_ID),
    ).rejects.toThrow(SegmentNotFoundError);
  });

  it("passes offset correctly to the query", async () => {
    const db = makeDb();
    db.queryOne.mockResolvedValueOnce(SEGMENT_ROW);
    db.query.mockResolvedValueOnce([]);

    const deps: ServiceDeps = { db };
    await getMembers(deps, SEGMENT_ID, PROMOTER_ID, 50, 200);

    const queryCall = db.query.mock.calls[0];
    const params = queryCall?.[1] as unknown[];
    expect(params).toContain(200);
    expect(params).toContain(50);
  });
});

// ─── exportSegment ────────────────────────────────────────────────────────────

describe("exportSegment", () => {
  it("returns array of email strings", async () => {
    const db = makeDb();
    db.queryOne.mockResolvedValueOnce(SEGMENT_ROW);
    db.query.mockResolvedValueOnce([
      { email: "a@ex.com" },
      { email: "b@ex.com" },
    ]);

    const deps: ServiceDeps = { db };
    const emails = await exportSegment(deps, SEGMENT_ID, PROMOTER_ID);

    expect(emails).toEqual(["a@ex.com", "b@ex.com"]);
  });

  it("includes LIMIT 50000 in the SQL", async () => {
    const db = makeDb();
    db.queryOne.mockResolvedValueOnce(SEGMENT_ROW);
    db.query.mockResolvedValueOnce([]);

    const deps: ServiceDeps = { db };
    await exportSegment(deps, SEGMENT_ID, PROMOTER_ID);

    const sql = db.query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("50000");
  });

  it("throws SegmentNotFoundError for unknown segment", async () => {
    const db = makeDb();
    db.queryOne.mockResolvedValueOnce(null);

    const deps: ServiceDeps = { db };
    await expect(
      exportSegment(deps, "ghost-seg", PROMOTER_ID),
    ).rejects.toThrow(SegmentNotFoundError);
  });
});

// ─── listSegments ─────────────────────────────────────────────────────────────

describe("listSegments", () => {
  it("returns all segments for the promoter", async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([SEGMENT_ROW, { ...SEGMENT_ROW, id: "seg-002" }]);

    const deps: ServiceDeps = { db };
    const segments = await listSegments(deps, PROMOTER_ID);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.id).toBe(SEGMENT_ID);
    expect(segments[1]?.id).toBe("seg-002");
  });

  it("returns empty array when promoter has no segments", async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);

    const deps: ServiceDeps = { db };
    const segments = await listSegments(deps, PROMOTER_ID);
    expect(segments).toEqual([]);
  });

  it("passes promoter_id as a query parameter (not interpolated)", async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);

    const deps: ServiceDeps = { db };
    await listSegments(deps, PROMOTER_ID);

    const params = db.query.mock.calls[0]?.[1] as unknown[];
    expect(params).toContain(PROMOTER_ID);
  });
});

// ─── deleteSegment ────────────────────────────────────────────────────────────

describe("deleteSegment", () => {
  it("calls DELETE and succeeds when rowsAffected = 1", async () => {
    const db = makeDb();
    db.execute.mockResolvedValueOnce({ rowsAffected: 1 });

    const deps: ServiceDeps = { db };
    await expect(
      deleteSegment(deps, SEGMENT_ID, PROMOTER_ID),
    ).resolves.toBeUndefined();
  });

  it("throws SegmentNotFoundError when rowsAffected = 0", async () => {
    const db = makeDb();
    db.execute.mockResolvedValueOnce({ rowsAffected: 0 });

    const deps: ServiceDeps = { db };
    await expect(
      deleteSegment(deps, "ghost-seg", PROMOTER_ID),
    ).rejects.toThrow(SegmentNotFoundError);
  });

  it("includes both segmentId and promoterId in query params", async () => {
    const db = makeDb();
    db.execute.mockResolvedValueOnce({ rowsAffected: 1 });

    const deps: ServiceDeps = { db };
    await deleteSegment(deps, SEGMENT_ID, PROMOTER_ID);

    const params = db.execute.mock.calls[0]?.[1] as unknown[];
    expect(params).toContain(SEGMENT_ID);
    expect(params).toContain(PROMOTER_ID);
  });

  it("does not delete a segment that belongs to a different promoter", async () => {
    const db = makeDb();
    // Simulate DB returning 0 because promoter_id didn't match
    db.execute.mockResolvedValueOnce({ rowsAffected: 0 });

    const deps: ServiceDeps = { db };
    await expect(
      deleteSegment(deps, SEGMENT_ID, "other-promoter"),
    ).rejects.toThrow(SegmentNotFoundError);
  });

  // ── Full-filter createSegment integration check ──────────────────────────

  it("createSegment works with a complex FULL_FILTER", async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ count: "7" }]);
    db.query.mockResolvedValueOnce([
      { ...SEGMENT_ROW, filter: FULL_FILTER, estimated_size: 7 },
    ]);

    const deps: ServiceDeps = { db };
    const result = await createSegment(deps, PROMOTER_ID, "Full filter segment", FULL_FILTER);
    expect(result.estimatedSize).toBe(7);
    expect(result.filter).toEqual(FULL_FILTER);
  });
});
