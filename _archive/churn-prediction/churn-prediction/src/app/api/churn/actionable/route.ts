/**
 * GET /api/churn/actionable
 *
 * Returns all churn predictions that have a pending retention action and
 * meet the requested probability threshold and horizon.
 *
 * This endpoint is intended exclusively for the internal Marketing Service.
 * It is protected by a shared secret (INTERNAL_API_KEY) and rate-limited to
 * 10 requests per minute per calling IP.
 *
 * Query parameters:
 *   min_probability — float in [0,1], default 0.6
 *   horizon         — '30d' | '14d' | '7d', default '14d'
 *
 * Response 200:
 *   { predictions: ChurnPrediction[], total: number }
 *
 * Response 401: missing or invalid Authorization header
 * Response 429: rate limit exceeded
 */

import { NextRequest, NextResponse } from "next/server";
import { getActionableChurnPredictions } from "../../../../services/churn-scoring.service";
import {
  ChurnPrediction,
  DbAdapter,
  PredictionHorizon,
} from "../../../../types/churn.types";

// ─── Rate limiter (sliding window, in-process) ────────────────────────────────

/** Per-IP request log: timestamps of requests within the current window. */
const rateLimitStore = new Map<string, number[]>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (rateLimitStore.get(ip) ?? []).filter(
    (t) => t > windowStart,
  );
  timestamps.push(now);
  rateLimitStore.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

// ─── Auth guard ───────────────────────────────────────────────────────────────

function isAuthorised(request: NextRequest): boolean {
  const apiKey = process.env["INTERNAL_API_KEY"];
  if (!apiKey) return false;
  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  return scheme === "Bearer" && token === apiKey;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

const VALID_HORIZONS = new Set<string>(["30d", "14d", "7d"]);

function parseMinProbability(raw: string | null): number {
  if (raw === null) return 0.6;
  const parsed = Number(raw);
  if (isNaN(parsed) || parsed < 0 || parsed > 1) return 0.6;
  return parsed;
}

function parseHorizon(raw: string | null): PredictionHorizon {
  if (raw !== null && VALID_HORIZONS.has(raw)) {
    return raw as PredictionHorizon;
  }
  return "14d";
}

// ─── DB adapter factory (production wiring) ───────────────────────────────────
//
// In production this would import from a shared db connection pool module.
// The function signature matches the DbAdapter interface so it can be swapped
// in tests.

function getDb(): DbAdapter {
  // Placeholder — real implementation imports from @tixly/db
  throw new Error(
    "getDb() must be wired to a real DbAdapter before deploying. " +
      "Import from @tixly/db or inject via middleware.",
  );
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── Rate limiting ────────────────────────────────────────────────────────
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Limit: 10 per minute." },
      {
        status: 429,
        headers: {
          "Retry-After": "60",
          "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
          "X-RateLimit-Window": "60s",
        },
      },
    );
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
  if (!isAuthorised(request)) {
    return NextResponse.json(
      { error: "Unauthorized. Provide a valid Bearer token." },
      { status: 401 },
    );
  }

  // ── Parse query params ───────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const minProbability = parseMinProbability(searchParams.get("min_probability"));
  const horizon = parseHorizon(searchParams.get("horizon"));

  // ── Query ────────────────────────────────────────────────────────────────
  let predictions: ChurnPrediction[];
  try {
    const db = getDb();
    predictions = await getActionableChurnPredictions(
      minProbability,
      horizon,
      db,
    );
  } catch (err) {
    console.error("[GET /api/churn/actionable] Query error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    predictions,
    total: predictions.length,
  });
}
