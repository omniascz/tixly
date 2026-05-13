// ---------------------------------------------------------------------------
// POST /api/accreditations/[accreditationId]/reject — reject accreditation
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AccreditationService } from '../../../../../services/accreditation.service';
import type { AccreditationDbAdapter } from '../../../../../services/accreditation.service';
import { AccreditationNotFoundError } from '../../../../../types/accreditation.types';

const RejectSchema = z.object({
  reason: z.string().min(1, 'reason is required'),
  user_id: z.string().min(1, 'user_id is required'),
});

const db = {} as AccreditationDbAdapter;
const service = new AccreditationService();

export async function POST(
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

  const parsed = RejectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const updated = await service.rejectAccreditation(
      accreditationId,
      parsed.data.user_id,
      parsed.data.reason,
      db
    );
    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    if (err instanceof AccreditationNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error('[POST /reject] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
