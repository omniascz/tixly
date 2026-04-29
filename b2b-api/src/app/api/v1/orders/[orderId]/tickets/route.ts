import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, requireScope, errorResponse } from "../../../../../../middleware/api-key-auth";
import { applyRateLimit, withRateLimitHeaders } from "../../../../../../middleware/rate-limit";

interface TicketsDBAdapter {
  getOrderTickets(orderId: string, promoterId: string): Promise<TicketSummary[] | null>;
}

interface TicketSummary {
  id: string;
  ticket_type: string;
  status: string;
  seat_info: string | null;
  holder_name: string | null;
  holder_email: string | null;
  scanned_at: string | null;
  qr_token: string | null; // pouze pokud scope read:tickets
}

const db = {} as TicketsDBAdapter;

// ---------------------------------------------------------------------------
// GET /api/v1/orders/:orderId/tickets
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } }
): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const scopeError = requireScope(auth, "read:orders");
  if (scopeError) return scopeError;

  const rl = await applyRateLimit(auth);
  if ("blocked" in rl) return rl.blocked;

  const tickets = await db.getOrderTickets(params.orderId, auth.promoterId);

  if (tickets === null) {
    return withRateLimitHeaders(
      errorResponse(404, "ORDER_NOT_FOUND", "Order not found", auth.requestId),
      rl.headers
    );
  }

  const hasTicketScope = auth.scopes.includes("read:tickets");

  return withRateLimitHeaders(
    NextResponse.json({
      data: tickets.map((t) => ({
        ...t,
        // QR token pouze s explicitním read:tickets scope
        qr_token: hasTicketScope ? t.qr_token : undefined,
      })),
      count: tickets.length,
    }),
    rl.headers
  );
}
