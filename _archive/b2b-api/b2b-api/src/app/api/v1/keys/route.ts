import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, requireScope, errorResponse } from "../../../../middleware/api-key-auth";
import { applyRateLimit, withRateLimitHeaders } from "../../../../middleware/rate-limit";
import { ApiKeyService, ApiKeyError, VALID_SCOPES, apiKeyDb } from "../../../../services/api-key.service";

const service = new ApiKeyService(apiKeyDb);

// ---------------------------------------------------------------------------
// GET /api/v1/keys — seznam API klíčů promotéra
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const scopeError = requireScope(auth, "admin:keys");
  if (scopeError) return scopeError;

  const rl = await applyRateLimit(auth);
  if ("blocked" in rl) return rl.blocked;

  const keys = await service.list(auth.promoterId);

  return withRateLimitHeaders(
    NextResponse.json({ data: keys, count: keys.length }),
    rl.headers
  );
}

// ---------------------------------------------------------------------------
// POST /api/v1/keys — vytvoření nového API klíče
//
// Body:
// {
//   "name": "POS systém prodejny Praha",
//   "scopes": ["write:orders", "read:events"],
//   "environment": "live",
//   "tier": "standard",
//   "ip_whitelist": ["1.2.3.4"],  // volitelné
//   "expires_at": "2027-01-01T00:00:00Z"  // volitelné
// }
//
// Response (201):
// {
//   "id": "uuid",
//   "raw_key": "tick_live_XXXX",  // ZOBRAZÍ SE POUZE JEDNOU
//   "prefix": "tick_live_Ab3xYz",
//   "name": "...",
//   "scopes": [...],
//   "environment": "live",
//   "tier": "standard",
//   "created_at": "ISO8601",
//   "warning": "Store this key securely — it will not be shown again."
// }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const scopeError = requireScope(auth, "admin:keys");
  if (scopeError) return scopeError;

  const rl = await applyRateLimit(auth);
  if ("blocked" in rl) return rl.blocked;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "Request body must be valid JSON", auth.requestId);
  }

  // Validace povinných polí
  if (!body.name || typeof body.name !== "string") {
    return errorResponse(400, "VALIDATION_ERROR", "'name' is required", auth.requestId);
  }
  if (!Array.isArray(body.scopes) || body.scopes.length === 0) {
    return errorResponse(400, "VALIDATION_ERROR", "'scopes' must be a non-empty array", auth.requestId);
  }
  if (!["live", "test"].includes(body.environment as string)) {
    return errorResponse(400, "VALIDATION_ERROR", "'environment' must be 'live' or 'test'", auth.requestId);
  }

  try {
    const created = await service.create({
      promoterId: auth.promoterId,
      name: body.name as string,
      scopes: body.scopes as string[],
      environment: body.environment as "live" | "test",
      tier: (body.tier as "free" | "standard" | "premium") ?? "free",
      ipWhitelist: body.ip_whitelist as string[] | undefined,
      expiresAt: body.expires_at ? new Date(body.expires_at as string) : undefined,
    });

    return withRateLimitHeaders(
      NextResponse.json(
        {
          id: created.id,
          raw_key: created.rawKey,
          prefix: created.prefix,
          name: created.name,
          scopes: created.scopes,
          environment: created.environment,
          tier: created.tier,
          created_at: created.createdAt.toISOString(),
          warning: "Store this key securely — it will not be shown again.",
        },
        { status: 201 }
      ),
      rl.headers
    );
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return errorResponse(err.httpStatus, "VALIDATION_ERROR", err.message, auth.requestId);
    }
    throw err;
  }
}
