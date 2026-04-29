import { NextRequest, NextResponse } from 'next/server';
import { checkInByQR } from '../../../../services/booking.service';
import { isEntryError } from '../../../../lib/entry-errors';
import type { EntryDB } from '../../../../services/venue.service';

export interface CheckInDeps {
  db: EntryDB;
}

// ---------------------------------------------------------------------------
// POST /api/entry/checkin
// Body: { qrToken: string }
// Used by venue staff to scan and check in visitors
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  context?: { deps?: CheckInDeps },
): Promise<NextResponse> {
  const deps = context?.deps ?? getProductionDeps();

  const body = await request.json() as { qrToken?: string };

  if (!body.qrToken) {
    return NextResponse.json({ error: 'MISSING_QR_TOKEN' }, { status: 400 });
  }

  try {
    const booking = await checkInByQR(body.qrToken, deps.db);
    return NextResponse.json({ status: 'granted', booking }, { status: 200 });
  } catch (err) {
    if (isEntryError(err)) {
      return NextResponse.json(
        { status: 'denied', ...err.toHttpError() },
        { status: err.statusCode },
      );
    }
    throw err;
  }
}

function getProductionDeps(): CheckInDeps {
  throw new Error('Production dependencies not configured. Use dependency injection.');
}
