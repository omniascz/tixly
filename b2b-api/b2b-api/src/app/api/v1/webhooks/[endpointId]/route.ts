import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, requireScope, errorResponse } from "../../../../../middleware/api-key-auth";
import { applyRateLimit, withRateLimitHeaders } from "../../../../../middleware/rate-limit";

const VALID_EVENTS = [
  "order.created", "order.paid", "order.cancelled", "order.refunded",
  "ticket.issued", "ticket.scanned", "ticket.transferred", "ticket.revoked",
  "resale.listed", "resale.sold", "event.updated", "event.cancelled",
];

interface EndpointDBAdapter {
  getEndpoint(id: string, promoterId: string): Promise<EndpointDetail | null>;
  updateEndpoint(id: string, promoterId: string, patch: {
    url?: string;
    description?: string;
    events?: string[];
    status?: "active" | "disabled";
  }): Promise<EndpointDetail | null>;
  deleteEndpoint(id: string, promoterId: string): Promise<boolean>;
}

interface EndpointDetail {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  status: string;
  failure_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
  updated_at: string;
}

const db = {} as EndpointDBAdapter;

// ---------------------------------------------------------------------------
// GET /api/v1/webhooks/:endpointId
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: { endpointId: string } }
): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const scopeError = requireScope(auth, "manage:webhooks");
  if (scopeError) return scopeError;

  const rl = await applyRateLimit(auth);
  if ("blocked" in rl) return rl.blocked;

  const endpoint = await db.getEndpoint(params.endpointId, auth.promoterId);

  if (!endpoint) {
    return withRateLimitHeaders(
      errorResponse(404, "ENDPOINT_NOT_FOUND", "Webhook endpoint not found", auth.requestId),
      rl.headers
    );
  }

  return withRateLimitHeaders(
    NextResponse.json({ data: endpoint }),
    rl.headers
  );
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/webhooks/:endpointId — aktualizace (URL, events, status)
// ---------------------------------------------------------------------------
export async function PATCH(
  request: NextRequest,
  { params }: { params: { endpointId: string } }
): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const scopeError = requireScope(auth, "manage:webhooks");
  if (scopeError) return scopeError;

  const rl = await applyRateLimit(auth);
  if ("blocked" in rl) return rl.blocked;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "Request body must be valid JSON", auth.requestId);
  }

  if (body.events) {
    const invalid = (body.events as string[]).filter((e) => !VALID_EVENTS.includes(e));
    if (invalid.length > 0) {
      return errorResponse(400, "VALIDATION_ERROR", `Invalid event types: ${invalid.join(", ")}`, auth.requestId);
    }
  }

  if (body.status && !["active", "disabled"].includes(body.status as string)) {
    return errorResponse(400, "VALIDATION_ERROR", "'status' must be 'active' or 'disabled'", auth.requestId);
  }

  const updated = await db.updateEndpoint(params.endpointId, auth.promoterId, {
    url: body.url as string | undefined,
    description: body.description as string | undefined,
    events: body.events as string[] | undefined,
    status: body.status as "active" | "disabled" | undefined,
  });

  if (!updated) {
    return withRateLimitHeaders(
      errorResponse(404, "ENDPOINT_NOT_FOUND", "Webhook endpoint not found", auth.requestId),
      rl.headers
    );
  }

  return withRateLimitHeaders(
    NextResponse.json({ data: updated }),
    rl.headers
  );
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/webhooks/:endpointId
// ---------------------------------------------------------------------------
export async function DELETE(
  request: NextRequest,
  { params }: { params: { endpointId: string } }
): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const scopeError = requireScope(auth, "manage:webhooks");
  if (scopeError) return scopeError;

  const rl = await applyRateLimit(auth);
  if ("blocked" in rl) return rl.blocked;

  const ok = await db.deleteEndpoint(params.endpointId, auth.promoterId);

  if (!ok) {
    return withRateLimitHeaders(
      errorResponse(404, "ENDPOINT_NOT_FOUND", "Webhook endpoint not found", auth.requestId),
      rl.headers
    );
  }

  return withRateLimitHeaders(
    new NextResponse(null, { status: 204 }),
    rl.headers
  );
}
