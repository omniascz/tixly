// ---------------------------------------------------------------------------
// GET   /api/accreditations/[accreditationId] — get single accreditation
// PATCH /api/accreditations/[accreditationId] — update notes, zone_access, valid_days
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { AccreditationDbAdapter } from '../../../../services/accreditation.service';
import { AccreditationNotFoundError } from '../../../../types/accreditation.types';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const PatchAccreditationSchema = z.object({
  notes: z.string().nullable().optional(),
  zone_access: z.array(z.string().min(1)).min(1).optional(),
  valid_days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Stub DB adapter — replace with your real implementation
// ---------------------------------------------------------------------------

const db = {} as AccreditationDbAdapter;

// ---------------------------------------------------------------------------
// GET — retrieve a single accreditation
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: { accreditationId: string } }
): Promise<NextResponse> {
  const { accreditationId } = params;

  const acc = await db.findAccreditation(accreditationId);
  if (!acc) {
    return NextResponse.json(
      { error: `Accreditation not found: ${accreditationId}` },
      { status: 404 }
    );
  }

  return NextResponse.json(acc, { status: 200 });
}

// ---------------------------------------------------------------------------
// PATCH — update notes, zone_access, valid_days (organizer only)
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: { accreditationId: string } }
): Promise<NextResponse> {
  const { accreditationId } = params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = PatchAccreditationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const updateData: Parameters<typeof db.updateAccreditation>[1] = {};
  if (parsed.data.notes !== undefined) {
    updateData.notes = parsed.data.notes;
  }
  if (parsed.data.zone_access !== undefined) {
    updateData.zone_access = parsed.data.zone_access;
  }
  if (parsed.data.valid_days !== undefined) {
    updateData.valid_days = parsed.data.valid_days;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: 'No fields to update. Provide notes, zone_access, or valid_days.' },
      { status: 400 }
    );
  }

  try {
    const updated = await db.updateAccreditation(accreditationId, updateData);
    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    if (err instanceof AccreditationNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error('[PATCH /accreditations/:id] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
