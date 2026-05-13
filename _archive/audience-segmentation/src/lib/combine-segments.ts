/**
 * combine-segments.ts
 *
 * Virtual segment combinator. Produces a SQL expression over the segment
 * member materialisation tables so multiple segments can be combined with
 * AND (intersection), OR (union), or NOT_IN (difference) without persisting
 * a new segment definition.
 *
 * Assumed schema:
 *   segmentation.segment_members(segment_id UUID, user_id UUID, promoter_id UUID)
 *
 * Each individual segment's members are materialised by refreshSegment().
 */

export type CombineOp = "and" | "or" | "not_in";

export interface CombineResult {
  sql: string;
  params: unknown[];
}

/**
 * Returns a SELECT returning user_id rows for the combined virtual segment.
 *
 *   and    — users present in ALL provided segments
 *   or     — users present in ANY of the provided segments
 *   not_in — users in segmentIds[0] but NOT in any of segmentIds[1..]
 *
 * The returned SQL is parameterised; pass params directly to db.query.
 */
export function combineSegments(
  segmentIds: string[],
  op: CombineOp,
): CombineResult {
  if (segmentIds.length === 0) {
    throw new Error("combineSegments requires at least one segment id");
  }
  if (op === "not_in" && segmentIds.length < 2) {
    throw new Error("not_in requires at least two segment ids");
  }

  const placeholders = segmentIds.map((_, i) => `$${i + 1}`);

  if (op === "or") {
    return {
      sql: `
        SELECT DISTINCT user_id
        FROM segmentation.segment_members
        WHERE segment_id = ANY(ARRAY[${placeholders.join(", ")}]::uuid[])
      `.trim(),
      params: [...segmentIds],
    };
  }

  if (op === "and") {
    return {
      sql: `
        SELECT user_id
        FROM segmentation.segment_members
        WHERE segment_id = ANY(ARRAY[${placeholders.join(", ")}]::uuid[])
        GROUP BY user_id
        HAVING COUNT(DISTINCT segment_id) = ${segmentIds.length}
      `.trim(),
      params: [...segmentIds],
    };
  }

  // not_in: base minus excludes
  const base = placeholders[0];
  const excludes = placeholders.slice(1).join(", ");
  return {
    sql: `
      SELECT user_id
      FROM segmentation.segment_members
      WHERE segment_id = ${base}
      AND user_id NOT IN (
        SELECT user_id
        FROM segmentation.segment_members
        WHERE segment_id = ANY(ARRAY[${excludes}]::uuid[])
      )
    `.trim(),
    params: [...segmentIds],
  };
}
