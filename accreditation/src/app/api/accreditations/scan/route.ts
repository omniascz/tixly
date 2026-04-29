// ---------------------------------------------------------------------------
// POST /api/accreditations/scan — gate scanning endpoint for accreditations
//
// Always returns HTTP 200. The `allowed` field in the response payload
// indicates whether entry was granted. HTTP errors (4xx/5xx) are reserved
// for genuine infrastructure failures.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AccreditationService } from '../../../../services/accreditation.service';
import type { AccreditationDbAdapter } from '../../../../services/accreditation.service';
import { getBadgeColor } from '../../../../lib/accreditation-validator';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const ScanRequestSchema = z.object({
  qr_code: z.string().min(1, 'qr_code is required'),
  zone_ids: z.array(z.string().min(1)).min(1, 'zone_ids must have at least one entry'),
});

// ---------------------------------------------------------------------------
// Stub DB adapter — replace with your real implementation
// ---------------------------------------------------------------------------

const db = {} as AccreditationDbAdapter;
const service = new AccreditationService();

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ScanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { qr_code, zone_ids } = parsed.data;

  try {
    const result = await service.scanAccreditation(qr_code, zone_ids, new Date(), db);
    // Always HTTP 200 — denial is in the payload
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    // Unexpected infrastructure error — return a safe denial response with HTTP 200
    console.error('[POST /accreditations/scan] Unexpected error:', err);
    return NextResponse.json(
      {
        allowed: false,
        accreditation_id: '',
        holder_name: '',
        accreditation_type: 'staff',
        badge_color: getBadgeColor('staff'),
        zone_name: '',
        valid_today: false,
        reason: 'Interní chyba serveru. Kontaktujte produkci.',
      },
      { status: 200 }
    );
  }
}
