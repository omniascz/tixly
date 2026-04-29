// ---------------------------------------------------------------------------
// GET  /api/events/[eventId]/accreditations — list event accreditations
// POST /api/events/[eventId]/accreditations — request / create accreditation
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AccreditationService } from '../../../../../services/accreditation.service';
import type { AccreditationDbAdapter } from '../../../../../services/accreditation.service';
import { AccreditationUnauthorizedError, AccreditationDuplicateError } from '../../../../../types/accreditation.types';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const AccreditationTypeSchema = z.enum([
  'staff', 'press', 'artist', 'vip_host', 'volunteer', 'vendor', 'organizer',
]);

const AccreditationStatusSchema = z.enum([
  'requested', 'approved', 'issued', 'active', 'rejected', 'revoked',
]);

const CreateAccreditationSchema = z.object({
  holder_name: z.string().min(1, 'holder_name is required'),
  holder_email: z.string().email('holder_email must be a valid email'),
  holder_phone: z.string().optional(),
  holder_organization: z.string().optional(),
  accreditation_type: AccreditationTypeSchema,
  role_description: z.string().optional(),
  zone_access: z.array(z.string().min(1)).min(1, 'zone_access must have at least one zone'),
  valid_days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  notes: z.string().optional(),
  requested_by_user_id: z.string().min(1, 'requested_by_user_id is required'),
});

const ListQuerySchema = z.object({
  type: AccreditationTypeSchema.optional(),
  status: AccreditationStatusSchema.optional(),
  organizer_id: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Stub DB adapter — replace with your real implementation
// ---------------------------------------------------------------------------

const db = {} as AccreditationDbAdapter;
const service = new AccreditationService();

// ---------------------------------------------------------------------------
// GET — list accreditations for event
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } }
): Promise<NextResponse> {
  const { eventId } = params;
  const { searchParams } = new URL(request.url);

  const queryParsed = ListQuerySchema.safeParse({
    type: searchParams.get('type') ?? undefined,
    status: searchParams.get('status') ?? undefined,
    organizer_id: searchParams.get('organizer_id') ?? undefined,
  });

  if (!queryParsed.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters', details: queryParsed.error.flatten() },
      { status: 400 }
    );
  }

  const { type, status, organizer_id } = queryParsed.data;

  if (!organizer_id) {
    return NextResponse.json(
      { error: 'organizer_id query parameter is required' },
      { status: 400 }
    );
  }

  try {
    const accreditations = await service.listEventAccreditations(
      eventId,
      organizer_id,
      { type, status },
      db
    );
    return NextResponse.json(accreditations, { status: 200 });
  } catch (err) {
    if (err instanceof AccreditationUnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error('[GET /accreditations] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — request / create accreditation
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: { eventId: string } }
): Promise<NextResponse> {
  const { eventId } = params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateAccreditationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const {
    holder_name,
    holder_email,
    holder_phone,
    holder_organization,
    accreditation_type,
    role_description,
    zone_access,
    valid_days,
    notes,
    requested_by_user_id,
  } = parsed.data;

  try {
    const accreditation = await service.requestAccreditation(
      eventId,
      requested_by_user_id,
      {
        holderName: holder_name,
        holderEmail: holder_email,
        holderPhone: holder_phone,
        holderOrganization: holder_organization,
        accreditationType: accreditation_type,
        roleDescription: role_description,
        zoneAccess: zone_access,
        validDays: valid_days,
        notes,
      },
      db
    );
    return NextResponse.json(accreditation, { status: 201 });
  } catch (err) {
    if (err instanceof AccreditationDuplicateError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    console.error('[POST /accreditations] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
