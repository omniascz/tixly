import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, requireScope, errorResponse } from "../../../../../middleware/api-key-auth";
import { applyRateLimit, withRateLimitHeaders } from "../../../../../middleware/rate-limit";

interface OrderDetailDBAdapter {
  getOrder(orderId: string, promoterId: string): Promise<OrderDetail | null>;
}

interface OrderDetail {
  id: string;
  event_id: string;
  event_title: string;
  status: string;
  total_amount: number;
  currency: string;
  customer: { email: string; name: string; phone: string | null };
  external_reference: string | null;
  metadata: Record<string, unknown> | null;
  items: Array<{
    ticket_type_id: string;
    ticket_type_name: string;
    quantity: number;
    unit_price: number;
  }>;
  ticket_count: number;
  created_at: string;
  updated_at: string;
}

const db = {} as OrderDetailDBAdapter;

// ---------------------------------------------------------------------------
// GET /api/v1/orders/:orderId
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

  const order = await db.getOrder(params.orderId, auth.promoterId);

  if (!order) {
    return withRateLimitHeaders(
      errorResponse(404, "ORDER_NOT_FOUND", "Order not found", auth.requestId),
      rl.headers
    );
  }

  return withRateLimitHeaders(
    NextResponse.json({ data: order }),
    rl.headers
  );
}
