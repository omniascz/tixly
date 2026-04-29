/**
 * GET    /api/segments/[segmentId]  — segment detail + refresh estimatedSize
 * DELETE /api/segments/[segmentId]  — delete segment
 *
 * GET also triggers a refresh of estimatedSize so the caller always sees
 * a fresh count. If the segment is large this can be slow; in production
 * you may want a dedicated PATCH /refresh endpoint and cache the size.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  DbAdapter,
  deleteSegment,
  refreshSegment,
  ServiceDeps,
} from "../../../../services/segmentation.service";
import { SegmentNotFoundError } from "../../../../types/segmentation.types";

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

// ─── GET /api/segments/[segmentId] ───────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { segmentId: string } },
): Promise<NextResponse> {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { segmentId } = params;

  let deps: ServiceDeps;
  try {
    deps = getDeps();
  } catch (err) {
    console.error("[GET /api/segments/[segmentId]] DB init error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  try {
    // Refresh also fetches and returns the updated segment
    const segment = await refreshSegment(deps, segmentId, auth.promoterId);
    return NextResponse.json({ segment });
  } catch (err) {
    if (err instanceof SegmentNotFoundError) {
      return NextResponse.json(
        { error: `Segment not found: ${segmentId}` },
        { status: 404 },
      );
    }
    console.error("[GET /api/segments/[segmentId]] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE /api/segments/[segmentId] ────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: { segmentId: string } },
): Promise<NextResponse> {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { segmentId } = params;

  let deps: ServiceDeps;
  try {
    deps = getDeps();
  } catch (err) {
    console.error("[DELETE /api/segments/[segmentId]] DB init error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  try {
    await deleteSegment(deps, segmentId, auth.promoterId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof SegmentNotFoundError) {
      return NextResponse.json(
        { error: `Segment not found: ${segmentId}` },
        { status: 404 },
      );
    }
    console.error("[DELETE /api/segments/[segmentId]] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
