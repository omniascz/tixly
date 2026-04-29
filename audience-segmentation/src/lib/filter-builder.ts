/**
 * filter-builder.ts
 *
 * Converts a SegmentFilter into a parameterised PostgreSQL WHERE clause.
 * All user-supplied values are bound via positional parameters ($1, $2, …)
 * — never interpolated as strings — preventing SQL injection.
 *
 * The generated SQL is designed to be embedded in the following base query:
 *
 *   SELECT u.id AS user_id, u.email, u.first_name
 *   FROM identity.users u
 *   LEFT JOIN loyalty.accounts la ON la.user_id = u.id
 *   WHERE <buildWhereClause result>
 *     AND u.promoter_id = $N   -- tenant isolation added by the caller
 */

import {
  BehavioralFilter,
  GeographicFilter,
  LoyaltyTierFilter,
  RfmFilter,
  SegmentFilter,
} from "../types/segmentation.types";
import { InvalidFilterError } from "../types/segmentation.types";

// ─── Return type ──────────────────────────────────────────────────────────────

export interface WhereClause {
  sql: string;
  params: unknown[];
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates and casts an unknown value to SegmentFilter.
 * Throws InvalidFilterError for semantic violations.
 */
export function validateFilter(filter: unknown): SegmentFilter {
  if (filter === null || typeof filter !== "object" || Array.isArray(filter)) {
    throw new InvalidFilterError("Filter must be a non-null object");
  }

  const raw = filter as Record<string, unknown>;
  const result: SegmentFilter = {};

  // ── Geographic ────────────────────────────────────────────────────────────
  if (raw["geographic"] !== undefined) {
    if (
      raw["geographic"] === null ||
      typeof raw["geographic"] !== "object" ||
      Array.isArray(raw["geographic"])
    ) {
      throw new InvalidFilterError(
        "geographic must be an object",
        "geographic",
      );
    }

    const geo = raw["geographic"] as Record<string, unknown>;
    const geoFilter: GeographicFilter = {};

    for (const key of ["city", "region", "country"] as const) {
      if (geo[key] !== undefined) {
        if (
          !Array.isArray(geo[key]) ||
          !(geo[key] as unknown[]).every((v) => typeof v === "string")
        ) {
          throw new InvalidFilterError(
            `geographic.${key} must be an array of strings`,
            `geographic.${key}`,
          );
        }
        geoFilter[key] = geo[key] as string[];
      }
    }

    result.geographic = geoFilter;
  }

  // ── Behavioral ────────────────────────────────────────────────────────────
  if (raw["behavioral"] !== undefined) {
    if (
      raw["behavioral"] === null ||
      typeof raw["behavioral"] !== "object" ||
      Array.isArray(raw["behavioral"])
    ) {
      throw new InvalidFilterError(
        "behavioral must be an object",
        "behavioral",
      );
    }

    const beh = raw["behavioral"] as Record<string, unknown>;
    const behFilter: BehavioralFilter = {};

    if (beh["minPurchases"] !== undefined) {
      if (
        typeof beh["minPurchases"] !== "number" ||
        beh["minPurchases"] < 0 ||
        !Number.isInteger(beh["minPurchases"])
      ) {
        throw new InvalidFilterError(
          "behavioral.minPurchases must be a non-negative integer",
          "behavioral.minPurchases",
        );
      }
      behFilter.minPurchases = beh["minPurchases"];
    }

    if (beh["maxPurchases"] !== undefined) {
      if (
        typeof beh["maxPurchases"] !== "number" ||
        beh["maxPurchases"] < 0 ||
        !Number.isInteger(beh["maxPurchases"])
      ) {
        throw new InvalidFilterError(
          "behavioral.maxPurchases must be a non-negative integer",
          "behavioral.maxPurchases",
        );
      }
      behFilter.maxPurchases = beh["maxPurchases"];
    }

    if (
      behFilter.minPurchases !== undefined &&
      behFilter.maxPurchases !== undefined &&
      behFilter.minPurchases > behFilter.maxPurchases
    ) {
      throw new InvalidFilterError(
        "behavioral.minPurchases cannot exceed behavioral.maxPurchases",
        "behavioral",
      );
    }

    if (beh["firstTimeBuyer"] !== undefined) {
      if (typeof beh["firstTimeBuyer"] !== "boolean") {
        throw new InvalidFilterError(
          "behavioral.firstTimeBuyer must be a boolean",
          "behavioral.firstTimeBuyer",
        );
      }
      behFilter.firstTimeBuyer = beh["firstTimeBuyer"];
    }

    if (beh["repeatingBuyer"] !== undefined) {
      if (typeof beh["repeatingBuyer"] !== "boolean") {
        throw new InvalidFilterError(
          "behavioral.repeatingBuyer must be a boolean",
          "behavioral.repeatingBuyer",
        );
      }
      behFilter.repeatingBuyer = beh["repeatingBuyer"];
    }

    if (beh["attendedEventIds"] !== undefined) {
      if (
        !Array.isArray(beh["attendedEventIds"]) ||
        !(beh["attendedEventIds"] as unknown[]).every(
          (v) => typeof v === "string",
        )
      ) {
        throw new InvalidFilterError(
          "behavioral.attendedEventIds must be an array of strings",
          "behavioral.attendedEventIds",
        );
      }
      behFilter.attendedEventIds = beh["attendedEventIds"] as string[];
    }

    result.behavioral = behFilter;
  }

  // ── RFM ───────────────────────────────────────────────────────────────────
  if (raw["rfm"] !== undefined) {
    if (
      raw["rfm"] === null ||
      typeof raw["rfm"] !== "object" ||
      Array.isArray(raw["rfm"])
    ) {
      throw new InvalidFilterError("rfm must be an object", "rfm");
    }

    const rfm = raw["rfm"] as Record<string, unknown>;
    const rfmFilter: RfmFilter = {};

    if (rfm["recencyDays"] !== undefined) {
      if (
        typeof rfm["recencyDays"] !== "number" ||
        rfm["recencyDays"] <= 0 ||
        !Number.isInteger(rfm["recencyDays"])
      ) {
        throw new InvalidFilterError(
          "rfm.recencyDays must be a positive integer",
          "rfm.recencyDays",
        );
      }
      rfmFilter.recencyDays = rfm["recencyDays"];
    }

    if (rfm["minFrequency"] !== undefined) {
      if (
        typeof rfm["minFrequency"] !== "number" ||
        rfm["minFrequency"] < 1 ||
        !Number.isInteger(rfm["minFrequency"])
      ) {
        throw new InvalidFilterError(
          "rfm.minFrequency must be a positive integer",
          "rfm.minFrequency",
        );
      }
      rfmFilter.minFrequency = rfm["minFrequency"];
    }

    if (rfm["minMonetaryValue"] !== undefined) {
      if (
        typeof rfm["minMonetaryValue"] !== "number" ||
        rfm["minMonetaryValue"] < 0 ||
        !Number.isInteger(rfm["minMonetaryValue"])
      ) {
        throw new InvalidFilterError(
          "rfm.minMonetaryValue must be a non-negative integer (haléře)",
          "rfm.minMonetaryValue",
        );
      }
      rfmFilter.minMonetaryValue = rfm["minMonetaryValue"];
    }

    result.rfm = rfmFilter;
  }

  // ── Loyalty tier ──────────────────────────────────────────────────────────
  if (raw["loyaltyTier"] !== undefined) {
    if (
      raw["loyaltyTier"] === null ||
      typeof raw["loyaltyTier"] !== "object" ||
      Array.isArray(raw["loyaltyTier"])
    ) {
      throw new InvalidFilterError(
        "loyaltyTier must be an object",
        "loyaltyTier",
      );
    }

    const lt = raw["loyaltyTier"] as Record<string, unknown>;

    if (!Array.isArray(lt["tiers"]) || lt["tiers"].length === 0) {
      throw new InvalidFilterError(
        "loyaltyTier.tiers must be a non-empty array",
        "loyaltyTier.tiers",
      );
    }

    const validTiers = new Set(["bronze", "silver", "gold", "platinum"]);
    const tiersArr = lt["tiers"] as unknown[];

    for (const tier of tiersArr) {
      if (typeof tier !== "string" || !validTiers.has(tier)) {
        throw new InvalidFilterError(
          `loyaltyTier.tiers contains invalid value: "${String(tier)}". Allowed: bronze, silver, gold, platinum`,
          "loyaltyTier.tiers",
        );
      }
    }

    const ltFilter: LoyaltyTierFilter = {
      tiers: tiersArr as LoyaltyTierFilter["tiers"],
    };
    result.loyaltyTier = ltFilter;
  }

  const hasAtLeastOne =
    result.geographic !== undefined ||
    result.behavioral !== undefined ||
    result.rfm !== undefined ||
    result.loyaltyTier !== undefined;

  if (!hasAtLeastOne) {
    throw new InvalidFilterError(
      "Filter must contain at least one of: geographic, behavioral, rfm, loyaltyTier",
    );
  }

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Appends a condition to the parts array and pushes all values into params.
 * Returns the updated parameter index (next $N).
 */
function addCondition(
  parts: string[],
  params: unknown[],
  sql: string,
  values: unknown[],
): void {
  // Replace placeholders: we receive sql with $1, $2 relative to the values
  // array; we re-number them to the global param list position.
  const offset = params.length;
  const renumbered = sql.replace(/\$(\d+)/g, (_match, n: string) => {
    return `$${offset + parseInt(n, 10)}`;
  });
  parts.push(renumbered);
  params.push(...values);
}

// ─── Sub-builders ─────────────────────────────────────────────────────────────

function buildGeographicConditions(
  geo: GeographicFilter,
  parts: string[],
  params: unknown[],
): void {
  // city, region, country live on identity.users (aliased as u)
  if (geo.city !== undefined && geo.city.length > 0) {
    const placeholders = geo.city.map((_, i) => `$${i + 1}`).join(", ");
    addCondition(parts, params, `u.city = ANY(ARRAY[${placeholders}])`, geo.city);
  }

  if (geo.region !== undefined && geo.region.length > 0) {
    const placeholders = geo.region.map((_, i) => `$${i + 1}`).join(", ");
    addCondition(
      parts,
      params,
      `u.region = ANY(ARRAY[${placeholders}])`,
      geo.region,
    );
  }

  if (geo.country !== undefined && geo.country.length > 0) {
    const placeholders = geo.country.map((_, i) => `$${i + 1}`).join(", ");
    addCondition(
      parts,
      params,
      `u.country = ANY(ARRAY[${placeholders}])`,
      geo.country,
    );
  }
}

function buildBehavioralConditions(
  beh: BehavioralFilter,
  parts: string[],
  params: unknown[],
): void {
  // Purchase count subquery
  const hasCountFilter =
    beh.minPurchases !== undefined || beh.maxPurchases !== undefined;

  if (hasCountFilter) {
    // Build a subquery that counts completed orders for the user
    const countSubquery = `(
      SELECT COUNT(*)
      FROM orders.orders o
      WHERE o.user_id = u.id
        AND o.status = 'completed'
    )`;

    if (beh.minPurchases !== undefined && beh.maxPurchases !== undefined) {
      addCondition(
        parts,
        params,
        `${countSubquery} BETWEEN $1 AND $2`,
        [beh.minPurchases, beh.maxPurchases],
      );
    } else if (beh.minPurchases !== undefined) {
      addCondition(
        parts,
        params,
        `${countSubquery} >= $1`,
        [beh.minPurchases],
      );
    } else if (beh.maxPurchases !== undefined) {
      addCondition(
        parts,
        params,
        `${countSubquery} <= $1`,
        [beh.maxPurchases],
      );
    }
  }

  // firstTimeBuyer: exactly 1 completed order
  if (beh.firstTimeBuyer === true) {
    addCondition(
      parts,
      params,
      `(
        SELECT COUNT(*)
        FROM orders.orders o
        WHERE o.user_id = u.id
          AND o.status = 'completed'
      ) = 1`,
      [],
    );
  }

  // repeatingBuyer: more than 1 completed order
  if (beh.repeatingBuyer === true) {
    addCondition(
      parts,
      params,
      `(
        SELECT COUNT(*)
        FROM orders.orders o
        WHERE o.user_id = u.id
          AND o.status = 'completed'
      ) > 1`,
      [],
    );
  }

  // attendedEventIds: user has at least one ticket for each provided event
  if (
    beh.attendedEventIds !== undefined &&
    beh.attendedEventIds.length > 0
  ) {
    const placeholders = beh.attendedEventIds
      .map((_, i) => `$${i + 1}`)
      .join(", ");
    addCondition(
      parts,
      params,
      `EXISTS (
        SELECT 1
        FROM orders.order_items oi
        JOIN orders.orders o ON o.id = oi.order_id
        WHERE o.user_id = u.id
          AND o.status = 'completed'
          AND oi.event_id = ANY(ARRAY[${placeholders}])
      )`,
      beh.attendedEventIds,
    );
  }
}

function buildRfmConditions(
  rfm: RfmFilter,
  parts: string[],
  params: unknown[],
): void {
  // recency: last purchase within N days
  if (rfm.recencyDays !== undefined) {
    addCondition(
      parts,
      params,
      `(
        SELECT MAX(o.created_at)
        FROM orders.orders o
        WHERE o.user_id = u.id
          AND o.status = 'completed'
      ) >= NOW() - ($1 * INTERVAL '1 day')`,
      [rfm.recencyDays],
    );
  }

  // frequency: total order count >= minFrequency
  if (rfm.minFrequency !== undefined) {
    addCondition(
      parts,
      params,
      `(
        SELECT COUNT(*)
        FROM orders.orders o
        WHERE o.user_id = u.id
          AND o.status = 'completed'
      ) >= $1`,
      [rfm.minFrequency],
    );
  }

  // monetary: SUM(total) >= minMonetaryValue (haléře, stored as INTEGER)
  if (rfm.minMonetaryValue !== undefined) {
    addCondition(
      parts,
      params,
      `(
        SELECT COALESCE(SUM(o.total), 0)
        FROM orders.orders o
        WHERE o.user_id = u.id
          AND o.status = 'completed'
      ) >= $1`,
      [rfm.minMonetaryValue],
    );
  }
}

function buildLoyaltyTierConditions(
  lt: LoyaltyTierFilter,
  parts: string[],
  params: unknown[],
): void {
  // loyalty.accounts is LEFT JOINed as la in the base query
  const placeholders = lt.tiers.map((_, i) => `$${i + 1}`).join(", ");
  addCondition(
    parts,
    params,
    `la.tier = ANY(ARRAY[${placeholders}])`,
    lt.tiers,
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Builds a parameterised PostgreSQL WHERE clause from a SegmentFilter.
 *
 * The returned sql string contains only $N positional parameters.
 * All actual values are in params — no user data is ever interpolated as SQL.
 *
 * Usage:
 *   const { sql, params } = buildWhereClause(filter);
 *   const rows = await db.query(
 *     `SELECT u.id, u.email, u.first_name
 *      FROM identity.users u
 *      LEFT JOIN loyalty.accounts la ON la.user_id = u.id
 *      WHERE u.promoter_id = $1
 *        AND ${sql}`,
 *     [promoterId, ...params],
 *   );
 */
export function buildWhereClause(filter: SegmentFilter): WhereClause {
  const parts: string[] = [];
  const params: unknown[] = [];

  if (filter.geographic !== undefined) {
    buildGeographicConditions(filter.geographic, parts, params);
  }

  if (filter.behavioral !== undefined) {
    buildBehavioralConditions(filter.behavioral, parts, params);
  }

  if (filter.rfm !== undefined) {
    buildRfmConditions(filter.rfm, parts, params);
  }

  if (filter.loyaltyTier !== undefined) {
    buildLoyaltyTierConditions(filter.loyaltyTier, parts, params);
  }

  const sql = parts.length > 0 ? parts.join("\n  AND ") : "TRUE";

  return { sql, params };
}
