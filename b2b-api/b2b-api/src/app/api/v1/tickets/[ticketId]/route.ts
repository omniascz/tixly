import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, requireScope, errorResponse } from "../../../../../middleware/api-key-auth";
import { applyRateLimit, withRateLimitHeaders } from "../../../../../middleware/rate-limit";

interface TicketDetailDBAdapter {
  getTicket(ticketId: string, promoterId: string): Promise<TicketDetail | null>;
}

interface TicketDetail {
  id: string;
  order_id: string;
  event_id: string;
  event_title: string;
  ticket_type: string;
  status: string;
  seat_info: string | null;
  holder_name: string | null;
  holder_email: string | null;
  qr_token: string | null;
  scanned_at: string | null;
  scan_count: number;
  created_at: string;
}

const db = {} as TicketDetailDBAdapter;

// ---------------------------------------------------------------------------
// GET /api/v1/tickets/:ticketId
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: { ticketId: string } }
): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const scopeError = requireScope(auth, "read:tickets");
  if (scopeError) return scopeError;

  const rl = await applyRateLimit(auth);
  if ("blocked" in rl) return rl.blocked;

  const ticket = await db.getTicket(params.ticketId, auth.promoterId);

  if (!ticket) {
    return withRateLimitHeaders(
      errorResponse(404, "TICKET_NOT_FOUND", "Ticket not found", auth.requestId),
      rl.headers
    );
  }

  return withRateLimitHeaders(
    NextResponse.json({ data: ticket }),
    rl.headers
  );
}
