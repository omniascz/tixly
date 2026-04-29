/**
 * Apple Wallet Web Service endpoints.
 *
 * Apple Wallet calls these endpoints to:
 *  1. Register a device for push updates.
 *  2. Unregister a device.
 *  3. Query which passes have been updated since a given timestamp.
 *  4. Download the latest version of a pass.
 *
 * All endpoints authenticate the caller via:
 *   Authorization: ApplePass {authenticationToken}
 *
 * where authenticationToken is the value embedded in pass.json at
 * generation time. Apple Wallet sends it on every request to this service.
 *
 * URL structure (Apple Wallet hardcodes this):
 *   GET    /v1/devices/{deviceId}/registrations/{passType}[?passesUpdatedSince=...]
 *   POST   /v1/devices/{deviceId}/registrations/{passType}/{serial}
 *   DELETE /v1/devices/{deviceId}/registrations/{passType}/{serial}
 *   GET    /v1/passes/{passType}/{serial}
 *
 * Next.js 14 App Router maps these with a catch-all route under
 * /api/wallet/apple/[...segments]/route.ts.
 *
 * NOTE: Apple expects the base webServiceURL from pass.json to be used as
 * the root; we set webServiceURL = "https://api.tixly.cz/api/wallet/apple"
 * so Apple will call:
 *   https://api.tixly.cz/api/wallet/apple/v1/devices/...
 *
 * The catch-all [...segments] handles all sub-paths.
 */

import { NextRequest, NextResponse } from "next/server";
import { AppleWalletService } from "@/services/apple-wallet.service";
import type {
  AppleWalletDBAdapter,
  HttpClient,
} from "@/services/apple-wallet.service";
import type { ApplePassData } from "@/types/wallet";

// ---------------------------------------------------------------------------
// Stub DB / HTTP adapters — replace with real implementations
// ---------------------------------------------------------------------------

function createStubDB(): AppleWalletDBAdapter {
  return {
    async getRegistrations() { return []; },
    async upsertRegistration() { /* no-op */ },
    async deleteRegistration() { /* no-op */ },
    async getUpdatedSerials() { return []; },
    async getAuthToken() { return null; },
  };
}

function createStubHttp(): HttpClient {
  return {
    async post() { return { statusCode: 200, body: "{}" }; },
  };
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

/**
 * Extracts the authentication token from "Authorization: ApplePass <token>".
 * Returns null if the header is missing or malformed.
 */
function extractApplePassToken(request: NextRequest): string | null {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("ApplePass ")) return null;
  return auth.slice("ApplePass ".length).trim() || null;
}

// ---------------------------------------------------------------------------
// Catch-all route handler
// ---------------------------------------------------------------------------

type SegmentContext = { params: { segments: string[] } };

/**
 * Routes Apple Wallet Web Service requests based on the URL path segments.
 *
 * Supported patterns (segments after /api/wallet/apple):
 *   GET  v1/devices/{deviceId}/registrations/{passType}
 *   POST v1/devices/{deviceId}/registrations/{passType}/{serial}
 *   DEL  v1/devices/{deviceId}/registrations/{passType}/{serial}
 *   GET  v1/passes/{passType}/{serial}
 */
export async function GET(
  request: NextRequest,
  { params }: SegmentContext
): Promise<NextResponse> {
  const segments = params.segments;
  // v1/devices/{deviceId}/registrations/{passType}
  if (
    segments.length === 4 &&
    segments[0] === "v1" &&
    segments[1] === "devices" &&
    segments[3] === "registrations"
  ) {
    return handleGetRegistrations(request, segments[2]!);
  }

  // v1/passes/{passType}/{serial}
  if (segments.length === 4 && segments[0] === "v1" && segments[1] === "passes") {
    return handleGetPass(request, segments[2]!, segments[3]!);
  }

  // v1/devices/{deviceId}/registrations/{passType} with passType at index 4
  // pattern: ["v1", "devices", deviceId, "registrations", passType]
  if (
    segments.length === 5 &&
    segments[0] === "v1" &&
    segments[1] === "devices" &&
    segments[3] === "registrations"
  ) {
    return handleGetRegistrations(request, segments[2]!, segments[4]);
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST(
  request: NextRequest,
  { params }: SegmentContext
): Promise<NextResponse> {
  const segments = params.segments;
  // v1/devices/{deviceId}/registrations/{passType}/{serial}
  if (
    segments.length === 6 &&
    segments[0] === "v1" &&
    segments[1] === "devices" &&
    segments[3] === "registrations"
  ) {
    return handlePostRegistration(
      request,
      segments[2]!,
      segments[4]!,
      segments[5]!
    );
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(
  request: NextRequest,
  { params }: SegmentContext
): Promise<NextResponse> {
  const segments = params.segments;
  // v1/devices/{deviceId}/registrations/{passType}/{serial}
  if (
    segments.length === 6 &&
    segments[0] === "v1" &&
    segments[1] === "devices" &&
    segments[3] === "registrations"
  ) {
    return handleDeleteRegistration(
      request,
      segments[2]!,
      segments[4]!,
      segments[5]!
    );
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

/**
 * GET /v1/devices/{deviceId}/registrations/{passType}[?passesUpdatedSince=...]
 *
 * Returns serial numbers of passes registered to this device that have
 * been updated since the given ISO timestamp.
 *
 * Response 200: { "serialNumbers": [...], "lastUpdated": "ISO-8601" }
 * Response 204: No updated passes (Apple expects 204, not 200 with empty array)
 */
async function handleGetRegistrations(
  request: NextRequest,
  deviceLibraryIdentifier: string,
  passTypeIdentifier?: string
): Promise<NextResponse> {
  const passType = passTypeIdentifier ?? "pass.cz.tixly.ticket";
  const passesUpdatedSince =
    request.nextUrl.searchParams.get("passesUpdatedSince") ?? undefined;

  const service = new AppleWalletService(createStubDB(), createStubHttp());
  const result = await service.getUpdatedPassSerials(
    deviceLibraryIdentifier,
    passType,
    passesUpdatedSince
  );

  if (result.serialNumbers.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  return NextResponse.json(result, { status: 200 });
}

/**
 * POST /v1/devices/{deviceId}/registrations/{passType}/{serial}
 *
 * Body: { "pushToken": "..." }
 * Headers: Authorization: ApplePass {authenticationToken}
 *
 * Response 201: Device registered for the first time
 * Response 200: Device already registered (idempotent)
 */
async function handlePostRegistration(
  request: NextRequest,
  deviceLibraryIdentifier: string,
  passTypeIdentifier: string,
  serialNumber: string
): Promise<NextResponse> {
  const authToken = extractApplePassToken(request);
  if (!authToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { pushToken?: string };
  try {
    body = (await request.json()) as { pushToken?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.pushToken) {
    return NextResponse.json({ error: "Missing pushToken" }, { status: 400 });
  }

  const db = createStubDB();
  const service = new AppleWalletService(db, createStubHttp());

  try {
    await service.handleRegistration(
      deviceLibraryIdentifier,
      passTypeIdentifier,
      serialNumber,
      authToken,
      body.pushToken
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("invalid authToken") || msg.includes("unknown serial")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[apple-wallet] registration error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return new NextResponse(null, { status: 201 });
}

/**
 * DELETE /v1/devices/{deviceId}/registrations/{passType}/{serial}
 *
 * Headers: Authorization: ApplePass {authenticationToken}
 *
 * Response 200: Successfully unregistered
 */
async function handleDeleteRegistration(
  request: NextRequest,
  deviceLibraryIdentifier: string,
  passTypeIdentifier: string,
  serialNumber: string
): Promise<NextResponse> {
  const authToken = extractApplePassToken(request);
  if (!authToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = new AppleWalletService(createStubDB(), createStubHttp());
  await service.handleUnregistration(
    deviceLibraryIdentifier,
    passTypeIdentifier,
    serialNumber
  );

  return new NextResponse(null, { status: 200 });
}

/**
 * GET /v1/passes/{passType}/{serial}
 *
 * Called by Apple Wallet after receiving an APN push to fetch the updated pass.
 * Headers: Authorization: ApplePass {authenticationToken}
 *
 * Response 200: .pkpass binary
 * Response 304: Pass not modified (if If-Modified-Since matches updatedAt)
 */
async function handleGetPass(
  request: NextRequest,
  passTypeIdentifier: string,
  serialNumber: string
): Promise<NextResponse> {
  const authToken = extractApplePassToken(request);
  if (!authToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TODO: Validate authToken against DB record for this serialNumber
  // TODO: Check If-Modified-Since header → return 304 if not modified
  // TODO: Load current ticket data from DB
  // TODO: Generate fresh QR payload (current TOTP)

  const ticketId = serialNumber.startsWith("ticket-")
    ? serialNumber.slice("ticket-".length)
    : serialNumber;

  const passData: ApplePassData = {
    // TODO: Load real data from DB
    eventTitle: "Event",
    venueName: "Venue",
    eventDate: "2026-06-15",
    eventTime: "19:30",
    holderName: "Holder",
    seatInfo: "A1",
    ticketType: "Standard",
    qrMessage: "stub-qr",
  };

  const service = new AppleWalletService(createStubDB(), createStubHttp());
  const pkpassBuffer = await service.generatePass(ticketId, passData);

  return new NextResponse(pkpassBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.apple.pkpass",
      "Last-Modified": new Date().toUTCString(),
      "Cache-Control": "no-store",
    },
  });
}
