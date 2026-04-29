import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, requireScope } from "../../../../middleware/api-key-auth";
import { applyRateLimit, withRateLimitHeaders } from "../../../../middleware/rate-limit";

interface EventListDBAdapter {
  listEvents(promoterId: string, filters: {
    status?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  }): Promise<{ events: EventSummary[]; total: number }>;
}

interface EventSummary {
  id: string;
  title: string;
  event_type: string;
  starts_at: string;
  ends_at: string;
  venue_name: string;
  status: string;
  total_capacity: number;
  tickets_sold: number;
  available: number;
}

const db = {} as EventListDBAdapter;

// ---------------------------------------------------------------------------
// GET /api/v1/events
// Query params: status, from, to, limit (default 50, max 200), offset
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const scopeError = requireScope(auth, "read:events");
  if (scopeError) return scopeError;

  const rl = await applyRateLimit(auth);
  if ("blocked" in rl) return rl.blocked;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const offset = parseInt(searchParams.get("offset") ?? "0");
  const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : undefined;
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : undefined;
  const status = searchParams.get("status") ?? undefined;

  const { events, total } = await db.listEvents(auth.promoterId, {
    status,
    from,
    to,
    limit,
    offset,
  });

  return withRateLimitHeaders(
    NextResponse.json({ data: events, total, limit, offset }),
    rl.headers
  );
}
