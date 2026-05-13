/**
 * GET /api/segments/[segmentId]/members
 *
 * Returns a paginated list of segment members (userId, email, firstName).
 *
 * Query parameters:
 *   limit  — rows per page, default 100, max 1000
 *   offset — rows to skip, default 0
 *
 * Response 200:
 *   { members: SegmentMember[]; limit: number; offset: number }
 *
 * Response 401: missing x-promoter-id
 * Response 404: segment not found or belongs to a different promoter
 */

import { NextRequest, NextResponse } from "next/server";
import {
  DbAdapter,
  getMembers,
  ServiceDeps,
} from "../../../../../services/segmentation.service";
import { SegmentNotFoundError } from "../../../../../types/segmentation.types";

// ─── DB adapter factory ───────────────────────────────────────────────────────

function getDb(): DbAdapter {
  throw new Error(
    "getDb() must be wired to a real DbAdapter before deploying.",
  );
}

function getDeps(): ServiceDeps {
  return { db: getDb() };
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function requireAuth(
  request: NextRequest,
): { promoterId: string } | NextResponse {
  const promoterId = request.headers.get("x-promoter-id");
  if (promoterId === null || promoterId.trim() === "") {
    return NextResponse.json(
      { error: "Unauthorized. Missing x-promoter-id header." },
      { status: 401 },
    );
  }
  return { promoterId };
}

// ─── GET /api/segments/[segmentId]/members ────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { segmentId: string } },
): Promise<NextResponse> {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { segmentId } = params;
  const searchParams = request.nextUrl.searchParams;

  const rawLimit = searchParams.get("limit");
  const rawOffset = searchParams.get("offset");

  const limit = rawLimit !== null ? parseInt(rawLimit, 10) : 100;
  const offset = rawOffset !== null ? parseInt(rawOffset, 10) : 0;

  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return NextResponse.json(
      { error: "limit must be an integer between 1 and 1000" },
      { status: 400 },
    );
  }

  if (!Number.isInteger(offset) || offset < 0) {
    return NextResponse.json(
      { error: "offset must be a non-negative integer" },
      { status: 400 },
    );
  }

  let deps: ServiceDeps;
  try {
    deps = getDeps();
  } catch (err) {
    console.error(
      "[GET /api/segments/[segmentId]/members] DB init error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  try {
    const members = await getMembers(
      deps,
      segmentId,
      auth.promoterId,
      limit,
      offset,
    );
    return NextResponse.json({ members, limit, offset });
  } catch (err) {
    if (err instanceof SegmentNotFoundError) {
      return NextResponse.json(
        { error: `Segment not found: ${segmentId}` },
        { status: 404 },
      );
    }
    console.error("[GET /api/segments/[segmentId]/members] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
