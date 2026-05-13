/**
 * GET  /api/segments  — list all segments for the authenticated promoter
 * POST /api/segments  — create a new segment
 *
 * Auth: Bearer token; x-promoter-id header set by API gateway after JWT
 * verification (same pattern as other Tixly routes).
 */

import { NextRequest, NextResponse } from "next/server";
import { validateFilter } from "../../../lib/filter-builder";
import {
  createSegment,
  DbAdapter,
  listSegments,
  ServiceDeps,
} from "../../../services/segmentation.service";
import { InvalidFilterError } from "../../../types/segmentation.types";

// ─── DB adapter factory (wire to real adapter before deploying) ───────────────

function getDb(): DbAdapter {
  throw new Error(
    "getDb() must be wired to a real DbAdapter before deploying. " +
      "Import from @tixly/db or inject via middleware.",
  );
}

function getDeps(): ServiceDeps {
  return { db: getDb() };
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function getPromoterIdFromRequest(request: NextRequest): string | null {
  return request.headers.get("x-promoter-id");
}

function requireAuth(
  request: NextRequest,
): { promoterId: string } | NextResponse {
  const promoterId = getPromoterIdFromRequest(request);
  if (promoterId === null || promoterId.trim() === "") {
    return NextResponse.json(
      { error: "Unauthorized. Missing x-promoter-id header." },
      { status: 401 },
    );
  }
  return { promoterId };
}

// ─── GET /api/segments ────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  let deps: ServiceDeps;
  try {
    deps = getDeps();
  } catch (err) {
    console.error("[GET /api/segments] DB init error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  try {
    const segments = await listSegments(deps, auth.promoterId);
    return NextResponse.json({ segments });
  } catch (err) {
    console.error("[GET /api/segments] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/segments ───────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 },
    );
  }

  const { name, filter: rawFilter } = body as Record<string, unknown>;

  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json(
      { error: "name is required and must be a non-empty string" },
      { status: 400 },
    );
  }

  let filter;
  try {
    filter = validateFilter(rawFilter);
  } catch (err) {
    if (err instanceof InvalidFilterError) {
      return NextResponse.json(
        { error: err.message, field: err.field },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
  }

  let deps: ServiceDeps;
  try {
    deps = getDeps();
  } catch (err) {
    console.error("[POST /api/segments] DB init error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  try {
    const segment = await createSegment(deps, auth.promoterId, name.trim(), filter);
    return NextResponse.json({ segment }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/segments] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
