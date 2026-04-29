import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { authenticateApiKey, requireScope, errorResponse } from "../../../../../../middleware/api-key-auth";
import { applyRateLimit, withRateLimitHeaders } from "../../../../../../middleware/rate-limit";
import { signWebhook } from "../../../../../../services/webhook-delivery.service";

interface TestWebhookDBAdapter {
  getEndpointForTest(id: string, promoterId: string): Promise<{
    url: string;
    signingSecret: string;
    status: string;
  } | null>;
}

interface HttpAdapter {
  post(url: string, body: string, headers: Record<string, string>): Promise<{
    status: number;
    ok: boolean;
    durationMs: number;
  }>;
}

const db = {} as TestWebhookDBAdapter;
const http = {} as HttpAdapter;

// ---------------------------------------------------------------------------
// POST /api/v1/webhooks/:endpointId/test
//
// Odešle testovací ping na endpoint. Vrátí HTTP status a latenci.
// Neukládá do webhook_deliveries — pouze okamžitý test.
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: { endpointId: string } }
): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const scopeError = requireScope(auth, "manage:webhooks");
  if (scopeError) return scopeError;

  const rl = await applyRateLimit(auth);
  if ("blocked" in rl) return rl.blocked;

  const endpoint = await db.getEndpointForTest(params.endpointId, auth.promoterId);

  if (!endpoint) {
    return withRateLimitHeaders(
      errorResponse(404, "ENDPOINT_NOT_FOUND", "Webhook endpoint not found", auth.requestId),
      rl.headers
    );
  }

  const testPayload = {
    id: randomBytes(16).toString("hex"),
    type: "webhook.test",
    created_at: new Date().toISOString(),
    data: {
      message: "This is a test webhook from Tixly.",
      endpoint_id: params.endpointId,
    },
    api_version: "2026-04-06",
  };

  const bodyStr = JSON.stringify(testPayload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signWebhook(bodyStr, endpoint.signingSecret, timestamp);

  let result: { status: number; ok: boolean; durationMs: number };
  try {
    result = await http.post(endpoint.url, bodyStr, {
      "Content-Type": "application/json",
      "Tixly-Signature": signature,
      "Tixly-Event": "webhook.test",
      "Tixly-Delivery-Id": testPayload.id,
      "User-Agent": "Tixly-Webhook/1.0",
    });
  } catch (err) {
    return withRateLimitHeaders(
      NextResponse.json({
        success: false,
        http_status: null,
        duration_ms: null,
        error: err instanceof Error ? err.message : "Network error",
      }),
      rl.headers
    );
  }

  return withRateLimitHeaders(
    NextResponse.json({
      success: result.ok,
      http_status: result.status,
      duration_ms: result.durationMs,
      payload_sent: testPayload,
    }),
    rl.headers
  );
}
