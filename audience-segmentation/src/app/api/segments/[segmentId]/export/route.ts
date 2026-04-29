/**
 * GET /api/segments/[segmentId]/export
 *
 * Exports all email addresses in the segment as a CSV file.
 * Hard-capped at 50 000 rows.
 *
 * Response 200: text/csv with Content-Disposition attachment header
 *   email
 *   alice@example.com
 *   bob@example.com
 *   ...
 *
 * Response 401: missing x-promoter-id
 * Response 404: segment not found or belongs to a different promoter
 */

import { NextRequest, NextResponse } from "next/server";
import {
  DbAdapter,
  exportSegment,
  ServiceDeps,
} from "../../../../../services/segmentation.service";
import { SegmentNotFoundError } from "../../../../../types/segmentation.types";

// ─── DB adapter factory ───────────────────────────────────────────────────────

function getDb(): DbAdapter {
  throw new Error(
    "getDb() must be wired to a real DbAdapter before deploying.",
  );
}

function getDeps(): ServiceDeps {
  return { db: getDb() };
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function requireAuth(
  request: NextRequest,
): { promoterId: string } | NextResponse {
  const promoterId = request.headers.get("x-promoter-id");
  if (promoterId === null || promoterId.trim() === "") {
    return NextResponse.json(
      { error: "Unauthorized. Missing x-promoter-id header." },
      { status: 401 },
    );
  }
  return { promoterId };
}

// ─── CSV serialization ────────────────────────────────────────────────────────

/**
 * Escapes a single CSV field value per RFC 4180.
 * Wraps in double-quotes if the value contains commas, quotes, or newlines.
 */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsv(emails: string[]): string {
  const lines = ["email", ...emails.map(csvField)];
  return lines.join("\r\n");
}

// ─── GET /api/segments/[segmentId]/export ─────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { segmentId: string } },
): Promise<NextResponse> {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { segmentId } = params;

  let deps: ServiceDeps;
  try {
    deps = getDeps();
  } catch (err) {
    console.error(
      "[GET /api/segments/[segmentId]/export] DB init error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  let emails: string[];
  try {
    emails = await exportSegment(deps, segmentId, auth.promoterId);
  } catch (err) {
    if (err instanceof SegmentNotFoundError) {
      return NextResponse.json(
        { error: `Segment not found: ${segmentId}` },
        { status: 404 },
      );
    }
    console.error("[GET /api/segments/[segmentId]/export] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const csv = buildCsv(emails);
  const filename = `segment-${segmentId}-export.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Warn callers if the export was capped
      ...(emails.length === 50_000
        ? { "X-Export-Capped": "true" }
        : {}),
    },
  });
}
