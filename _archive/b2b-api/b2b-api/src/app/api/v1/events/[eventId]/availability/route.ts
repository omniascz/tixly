import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, requireScope, errorResponse } from "../../../../../../middleware/api-key-auth";
import { applyRateLimit, withRateLimitHeaders } from "../../../../../../middleware/rate-limit";

interface AvailabilityDBAdapter {
  getAvailability(eventId: string, promoterId: string): Promise<Availability | null>;
}

interface Availability {
  event_id: string;
  status: string;
  total_capacity: number;
  tickets_sold: number;
  tickets_reserved: number; // seat locks
  available: number;
  ticket_types: Array<{
    id: string;
    name: string;
    available: number;
    price: number;
    currency: string;
  }>;
  updated_at: string;
}

const db = {} as AvailabilityDBAdapter;

// ---------------------------------------------------------------------------
// GET /api/v1/events/:eventId/availability
// Real-time dostupnost (nízká TTL cache — vhodné pro POS zobrazení)
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } }
): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const scopeError = requireScope(auth, "read:events");
  if (scopeError) return scopeError;

  const rl = await applyRateLimit(auth);
  if ("blocked" in rl) return rl.blocked;

  const availability = await db.getAvailability(params.eventId, auth.promoterId);

  if (!availability) {
    return withRateLimitHeaders(
      errorResponse(404, "EVENT_NOT_FOUND", "Event not found", auth.requestId),
      rl.headers
    );
  }

  return withRateLimitHeaders(
    NextResponse.json(
      { data: availability },
      {
        headers: {
          // Krátká cache pro POS — 5 sekund
          "Cache-Control": "public, max-age=5, stale-while-revalidate=10",
        },
      }
    ),
    rl.headers
  );
}
