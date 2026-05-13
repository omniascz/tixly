// ---------------------------------------------------------------------------
// POST /api/re-entry/scan — Staff gate scanning endpoint
//
// Always returns HTTP 200. The `allowed` field in the response payload
// indicates whether entry was granted. HTTP errors (4xx/5xx) are reserved
// for genuine infrastructure failures.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ReentryService } from '../../../../services/re-entry.service';
import type { ReentryDbAdapter } from '../../../../services/re-entry.service';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const ScanRequestSchema = z.object({
  ticket_id: z.string().min(1, 'ticket_id is required'),
  ticket_type_id: z.string().min(1, 'ticket_type_id is required'),
  event_id: z.string().min(1, 'event_id is required'),
  gate_id: z.string().min(1, 'gate_id is required'),
  gate_type: z.enum(['entry', 'exit', 'bidirectional']),
  staff_id: z.string().min(1, 'staff_id is required'),
});

// ---------------------------------------------------------------------------
// Stub DB adapter — replace with your real implementation
// ---------------------------------------------------------------------------

const db = {} as ReentryDbAdapter;
const reentryService = new ReentryService();

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const parsed = ScanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { ticket_id, ticket_type_id, event_id, gate_id, gate_type, staff_id } =
    parsed.data;

  try {
    const result = await reentryService.processScan(
      ticket_id,
      ticket_type_id,
      event_id,
      gate_id,
      gate_type,
      staff_id,
      db
    );

    // Always HTTP 200 — denied access is communicated via result.allowed
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    // Only unexpected (infrastructure) errors reach here
    console.error('[re-entry/scan] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
