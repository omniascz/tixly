import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { authenticateApiKey, requireScope, errorResponse } from "../../../../middleware/api-key-auth";
import { applyRateLimit, withRateLimitHeaders } from "../../../../middleware/rate-limit";

const VALID_EVENTS = [
  "order.created", "order.paid", "order.cancelled", "order.refunded",
  "ticket.issued", "ticket.scanned", "ticket.transferred", "ticket.revoked",
  "resale.listed", "resale.sold",
  "event.updated", "event.cancelled",
];

interface WebhookDBAdapter {
  listEndpoints(promoterId: string): Promise<WebhookEndpoint[]>;
  createEndpoint(input: {
    promoterId: string;
    url: string;
    description: string | null;
    events: string[];
    signingSecret: string;
  }): Promise<WebhookEndpoint>;
}

interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  status: string;
  failure_count: number;
  last_success_at: string | null;
  created_at: string;
}

const db = {} as WebhookDBAdapter;

// ---------------------------------------------------------------------------
// GET /api/v1/webhooks
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const scopeError = requireScope(auth, "manage:webhooks");
  if (scopeError) return scopeError;

  const rl = await applyRateLimit(auth);
  if ("blocked" in rl) return rl.blocked;

  const endpoints = await db.listEndpoints(auth.promoterId);

  return withRateLimitHeaders(
    NextResponse.json({ data: endpoints, count: endpoints.length }),
    rl.headers
  );
}

// ---------------------------------------------------------------------------
// POST /api/v1/webhooks — registrace nového endpointu
//
// Body:
// {
//   "url": "https://example.com/webhook",
//   "description": "Production webhook",
//   "events": ["order.paid", "ticket.scanned"]  // prázdné = všechny eventy
// }
//
// Response (201):
// {
//   "id": "uuid",
//   "url": "...",
//   "signing_secret": "whsec_XXXX",  // ZOBRAZÍ SE POUZE JEDNOU
//   "events": [...],
//   "status": "active"
// }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest): Promise<NextResponse> {
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

  if (!body.url || typeof body.url !== "string") {
    return errorResponse(400, "VALIDATION_ERROR", "'url' is required", auth.requestId);
  }

  // Validace URL
  try {
    const parsed = new URL(body.url as string);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error();
  } catch {
    return errorResponse(400, "VALIDATION_ERROR", "'url' must be a valid HTTP/HTTPS URL", auth.requestId);
  }

  const events = (body.events as string[] | undefined) ?? [];
  const invalidEvents = events.filter((e) => !VALID_EVENTS.includes(e));
  if (invalidEvents.length > 0) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      `Invalid event types: ${invalidEvents.join(", ")}. Valid: ${VALID_EVENTS.join(", ")}`,
      auth.requestId
    );
  }

  // Generovat signing secret
  const rawSecret = `whsec_${randomBytes(24).toString("base64url")}`;

  const endpoint = await db.createEndpoint({
    promoterId: auth.promoterId,
    url: body.url as string,
    description: (body.description as string) ?? null,
    events,
    signingSecret: rawSecret, // DB adapter musí šifrovat AES-256-GCM
  });

  return withRateLimitHeaders(
    NextResponse.json(
      {
        id: endpoint.id,
        url: endpoint.url,
        description: endpoint.description,
        events: endpoint.events,
        status: endpoint.status,
        signing_secret: rawSecret, // ZOBRAZÍ SE POUZE JEDNOU
        warning: "Store this signing secret securely — it will not be shown again.",
        created_at: endpoint.created_at,
      },
      { status: 201 }
    ),
    rl.headers
  );
}
