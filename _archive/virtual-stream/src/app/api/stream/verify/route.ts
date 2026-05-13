import { NextRequest, NextResponse } from "next/server";
import { StreamTokenService, StreamTokenError } from "../../../../services/stream-token.service";
import type { StreamDBAdapter } from "../../../../services/stream-token.service";
import type { GeoProvider } from "../../../../lib/geo-block";
import { createHmac, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// Stubs — nahradit reálnými instancemi z DI kontejneru
// ---------------------------------------------------------------------------
const db = {} as StreamDBAdapter;
const geoProvider = {} as GeoProvider;

const service = new StreamTokenService(
  db,
  geoProvider,
  process.env.STREAM_TOKEN_SECRET ?? ""
);

// ---------------------------------------------------------------------------
// POST /api/stream/verify
//
// Slouží jako webhook pro CDN (Mux, Cloudflare Stream) a server-side player.
// CDN volá tento endpoint před povolením přehrávání.
//
// Request body:
// {
//   "token": "...",    // stream token vydaný přes /stream-token
//   "eventId": "uuid" // volitelný double-check
// }
//
// Request musí být podepsán CDN HMAC-SHA256 signaturou v hlavičce
// X-CDN-Signature (hex) — sdílený secret STREAM_CDN_WEBHOOK_SECRET.
//
// Response (200):
// { "valid": true, "ticketId": "uuid", "userId": "uuid", "accessType": "live" }
//
// Response (401/403):
// { "valid": false, "error": "..." }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // --- CDN webhook signature ověření ---
  const cdnSecret = process.env.STREAM_CDN_WEBHOOK_SECRET;
  if (cdnSecret) {
    const rawBody = await request.text();
    const sig = request.headers.get("x-cdn-signature");

    if (!sig) {
      return NextResponse.json({ valid: false, error: "Missing signature" }, { status: 401 });
    }

    const expected = createHmac("sha256", cdnSecret).update(rawBody).digest("hex");

    try {
      if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
        return NextResponse.json({ valid: false, error: "Invalid signature" }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ valid: false, error: "Invalid signature" }, { status: 401 });
    }

    // Parsovat tělo (bylo přečteno jako text výše)
    let body: { token?: string; eventId?: string };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ valid: false, error: "Invalid JSON" }, { status: 400 });
    }

    return verifyStreamToken(body.token, body.eventId);
  }

  // Bez CDN secret — standardní JSON parse (dev/testing)
  let body: { token?: string; eventId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ valid: false, error: "Invalid JSON" }, { status: 400 });
  }

  return verifyStreamToken(body.token, body.eventId);
}

function verifyStreamToken(
  token: string | undefined,
  eventId?: string
): NextResponse {
  if (!token) {
    return NextResponse.json({ valid: false, error: "Missing token" }, { status: 400 });
  }

  try {
    const payload = service.verifyToken(token);

    // Volitelný double-check eventId
    if (eventId && payload.eid !== eventId) {
      return NextResponse.json(
        { valid: false, error: "Token event mismatch" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      valid: true,
      ticketId: payload.tid,
      userId: payload.uid,
      eventId: payload.eid,
      accessType: payload.type,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    });
  } catch (err) {
    if (err instanceof StreamTokenError) {
      return NextResponse.json(
        { valid: false, error: err.code },
        { status: err.httpStatus }
      );
    }
    return NextResponse.json({ valid: false, error: "Internal error" }, { status: 500 });
  }
}
