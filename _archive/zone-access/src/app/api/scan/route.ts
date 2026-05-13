// ---------------------------------------------------------------------------
// POST /api/scan — Staff gate scanning endpoint
//
// Always returns HTTP 200. The `allowed` field in the response payload
// indicates whether entry was granted. HTTP errors (4xx/5xx) are reserved
// for genuine infrastructure failures.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ZoneAccessService } from "../../../services/zone-access.service";
import type { ZoneAccessDbAdapter } from "../../../services/zone-access.service";
import {
  GateInactiveError,
  GateNotFoundError,
  TicketAlreadyScannedError,
  TicketNotFoundError,
  ZoneAccessDeniedError,
} from "../../../types/zone-access.types";
import {
  buildDenialReason,
  formatScanResult,
} from "../../../lib/zone-access-checker";

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const ScanRequestSchema = z.object({
  code: z.string().min(1, "code is required"),
  gate_id: z.string().min(1, "gate_id is required"),
  scanned_by_staff_id: z.string().min(1, "scanned_by_staff_id is required"),
});

// ---------------------------------------------------------------------------
// Stub DB adapter — replace with your real implementation
// ---------------------------------------------------------------------------

const db = {} as ZoneAccessDbAdapter;
const zoneAccessService = new ZoneAccessService();

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = ScanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { code, gate_id, scanned_by_staff_id } = parsed.data;

  const scanRequest = {
    code,
    gate_id,
    scanned_by_staff_id,
    scanned_at: new Date(),
  };

  try {
    const result = await zoneAccessService.processScan(scanRequest, db);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    // -------------------------------------------------------------------
    // Domain denials — return HTTP 200 with allowed: false
    // -------------------------------------------------------------------
    if (err instanceof ZoneAccessDeniedError) {
      const result = formatScanResult(
        false,
        {
          ticketId: "",
          ticketTypeName: "",
          holderName: "",
          zoneName: "",
          gateName: "",
          reason: err.message,
        },
        ""
      );
      return NextResponse.json(result, { status: 200 });
    }

    if (err instanceof TicketAlreadyScannedError) {
      const reason = buildDenialReason("already_scanned", "cs");
      const result = formatScanResult(
        false,
        {
          ticketId: "",
          ticketTypeName: "",
          holderName: "",
          zoneName: "",
          gateName: "",
          reason,
        },
        ""
      );
      return NextResponse.json(result, { status: 200 });
    }

    if (err instanceof TicketNotFoundError) {
      const result = formatScanResult(
        false,
        {
          ticketId: "",
          ticketTypeName: "",
          holderName: "",
          zoneName: "",
          gateName: "",
          reason: "Vstupenka nebyla nalezena.",
        },
        ""
      );
      return NextResponse.json(result, { status: 200 });
    }

    // -------------------------------------------------------------------
    // Infrastructure errors — gate not found / inactive are systemic
    // since the staff app should only use valid gate IDs
    // -------------------------------------------------------------------
    if (err instanceof GateNotFoundError || err instanceof GateInactiveError) {
      return NextResponse.json(
        { error: err.message },
        { status: 422 }
      );
    }

    // -------------------------------------------------------------------
    // Unexpected — 500
    // -------------------------------------------------------------------
    console.error("[scan] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
