import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export interface ApiKeyContext {
  keyId: string;
  promoterId: string;
  scopes: string[];
  tier: "free" | "standard" | "premium";
  environment: "live" | "test";
  requestId: string;
}

interface ApiKeyRecord {
  id: string;
  promoter_id: string;
  scopes: string[];
  tier: string;
  environment: string;
  ip_whitelist: string[] | null;
  status: string;
}

// ---------------------------------------------------------------------------
// DB adapter interface (injektovat v produkci)
// ---------------------------------------------------------------------------

export interface AuthDBAdapter {
  findApiKey(keyHash: string): Promise<ApiKeyRecord | null>;
  touchLastUsed(keyId: string): Promise<void>;
  logAuditEvent(entry: {
    apiKeyId: string;
    event: string;
    ipAddress: string | null;
    userAgent: string | null;
    endpoint: string;
    httpMethod: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

// Stub — nahradit reálnou DB instancí
export const authDb = {} as AuthDBAdapter;

// ---------------------------------------------------------------------------
// Regex pro validaci formátu klíče
// tick_live_XXXXXXXXXXXXXXXXXXXX (20 base64url znaků)
// tick_test_XXXXXXXXXXXXXXXXXXXX
// ---------------------------------------------------------------------------
const API_KEY_REGEX = /^tick_(live|test)_[A-Za-z0-9_-]{20}$/;

// ---------------------------------------------------------------------------
// Hlavní autentizační funkce
// ---------------------------------------------------------------------------

/**
 * Ověří API klíč z Authorization headeru.
 * Vrátí ApiKeyContext při úspěchu nebo NextResponse s chybou.
 */
export async function authenticateApiKey(
  request: NextRequest
): Promise<ApiKeyContext | NextResponse> {
  const requestId = `req_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const endpoint = new URL(request.url).pathname;
  const method = request.method;
  const userAgent = request.headers.get("user-agent");
  const clientIp = extractIp(request);

  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse(
      401,
      "MISSING_API_KEY",
      "Authorization header with Bearer token required",
      requestId
    );
  }

  const rawKey = authHeader.slice(7).trim();

  if (!API_KEY_REGEX.test(rawKey)) {
    return errorResponse(
      401,
      "INVALID_API_KEY_FORMAT",
      "Invalid API key format. Expected: tick_live_... or tick_test_...",
      requestId
    );
  }

  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  const apiKey = await authDb.findApiKey(keyHash);

  if (!apiKey) {
    return errorResponse(
      401,
      "INVALID_API_KEY",
      "Invalid or expired API key",
      requestId
    );
  }

  // IP whitelist check
  if (apiKey.ip_whitelist && apiKey.ip_whitelist.length > 0) {
    if (!clientIp || !apiKey.ip_whitelist.includes(clientIp)) {
      await authDb.logAuditEvent({
        apiKeyId: apiKey.id,
        event: "ip_blocked",
        ipAddress: clientIp,
        userAgent,
        endpoint,
        httpMethod: method,
        metadata: { blocked_ip: clientIp },
      });
      return errorResponse(
        403,
        "IP_NOT_WHITELISTED",
        "Your IP address is not allowed for this API key",
        requestId
      );
    }
  }

  // Aktualizace last_used_at (fire & forget — nechceme blokovat request)
  authDb.touchLastUsed(apiKey.id).catch(() => {});

  return {
    keyId: apiKey.id,
    promoterId: apiKey.promoter_id,
    scopes: apiKey.scopes,
    tier: apiKey.tier as "free" | "standard" | "premium",
    environment: apiKey.environment as "live" | "test",
    requestId,
  };
}

// ---------------------------------------------------------------------------
// Scope guard
// ---------------------------------------------------------------------------

/**
 * Zkontroluje, zda ApiKeyContext obsahuje požadovaný scope.
 * Vrátí chybový NextResponse pokud ne.
 */
export function requireScope(
  ctx: ApiKeyContext,
  scope: string
): NextResponse | null {
  if (!ctx.scopes.includes(scope)) {
    return errorResponse(
      403,
      "INSUFFICIENT_SCOPE",
      `This endpoint requires the '${scope}' scope`,
      ctx.requestId
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractIp(request: NextRequest): string | null {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null
  );
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string
): NextResponse {
  return NextResponse.json(
    { error: { code, message, request_id: requestId } },
    { status }
  );
}
