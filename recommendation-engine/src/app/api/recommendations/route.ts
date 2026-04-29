/**
 * GET /api/recommendations
 *
 * Returns personalised event recommendations for the authenticated user.
 *
 * Query parameters:
 *   limit    — number of results (default 10, max 50)
 *   category — filter by event category (optional)
 *   city     — filter by venue city (optional)
 *
 * Auth: JWT required (user_id extracted from token)
 * Rate limit: 60 requests / minute per user (Redis counter)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateRecommendations } from "../../../services/recommendation.service";
import {
  DbAdapter,
  RateLimitError,
  RedisAdapter,
} from "../../../types/recommendation.types";

// ─── Adapters (injected via module-level singletons in production) ────────────
// In a real Next.js deployment these would be imported from a shared
// infrastructure module (e.g., src/lib/db.ts, src/lib/redis.ts).

declare function getDb(): DbAdapter;
declare function getRedis(): RedisAdapter;
declare function verifyJwt(token: string): Promise<{ userId: string } | null>;

// ─── Validation schema ────────────────────────────────────────────────────────

const QuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 10))
    .pipe(z.number().int().min(1).max(50)),
  category: z.string().optional(),
  city: z.string().optional(),
});

// ─── Rate limiting ────────────────────────────────────────────────────────────

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const rateLimitKey = (userId: string) => `rate_limit:recommendations:${userId}`;

async function checkRateLimit(userId: string, redis: RedisAdapter): Promise<void> {
  const key = rateLimitKey(userId);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  }
  if (count > RATE_LIMIT_MAX) {
    throw new RateLimitError(userId);
  }
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

function detectDevice(
  userAgent: string,
): "mobile" | "desktop" | "tablet" {
  const ua = userAgent.toLowerCase();
  if (/tablet|ipad/.test(ua)) return "tablet";
  if (/mobile|android|iphone/.test(ua)) return "mobile";
  return "desktop";
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const redis = getRedis();

  // ── Auth ────────────────────────────────────────────────────────────────────
  const token = extractBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let userId: string;
  try {
    const payload = await verifyJwt(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    userId = payload.userId;
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // ── Rate limit ──────────────────────────────────────────────────────────────
  try {
    await checkRateLimit(userId, redis);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS),
            "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
          },
        },
      );
    }
    throw err;
  }

  // ── Query validation ────────────────────────────────────────────────────────
  const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(searchParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { limit, category, city } = parsed.data;
  const userAgent = request.headers.get("User-Agent") ?? "";
  const deviceType = detectDevice(userAgent);
  const hourOfDay = new Date().getHours();

  // ── Generate recommendations ─────────────────────────────────────────────────
  try {
    const result = await generateRecommendations(
      userId,
      {
        limit,
        categoryFilter: category,
        cityFilter: city,
        deviceType,
        hourOfDay,
      },
      { db: getDb(), redis },
    );

    return NextResponse.json(result, {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=60",
        "X-Model-Version": result.modelVersion,
      },
    });
  } catch (err) {
    console.error("[GET /api/recommendations] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
