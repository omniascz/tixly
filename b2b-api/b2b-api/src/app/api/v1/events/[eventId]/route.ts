import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, requireScope, errorResponse } from "../../../../../middleware/api-key-auth";
import { applyRateLimit, withRateLimitHeaders } from "../../../../../middleware/rate-limit";

interface EventDetailDBAdapter {
  getEvent(eventId: string, promoterId: string): Promise<EventDetail | null>;
}

interface EventDetail {
  id: string;
  title: string;
  description: string | null;
  event_type: string;
  starts_at: string;
  ends_at: string;
  venue: { id: string; name: string; city: string; address: string } | null;
  status: string;
  ticket_types: Array<{
    id: string;
    name: string;
    price: number;
    currency: string;
    total_capacity: number;
    available: number;
    attendance_type: string;
  }>;
  resale_enabled: boolean;
  created_at: string;
}

const db = {} as EventDetailDBAdapter;

// ---------------------------------------------------------------------------
// GET /api/v1/events/:eventId
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

  const event = await db.getEvent(params.eventId, auth.promoterId);

  if (!event) {
    return withRateLimitHeaders(
      errorResponse(404, "EVENT_NOT_FOUND", "Event not found", auth.requestId),
      rl.headers
    );
  }

  return withRateLimitHeaders(
    NextResponse.json({ data: event }),
    rl.headers
  );
}
