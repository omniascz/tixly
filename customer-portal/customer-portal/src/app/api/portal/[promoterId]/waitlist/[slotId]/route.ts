import { NextRequest, NextResponse } from 'next/server';
import {
  joinWaitlist,
  leaveWaitlist,
  getWaitlistPosition,
} from '../../../../../../services/waitlist.service';
import { isPortalError } from '../../../../../../lib/portal-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { promoterId: string; slotId: string } },
) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') ?? '';
    const db = getDb();
    const position = await getWaitlistPosition(params.slotId, userId, db);
    return NextResponse.json(position);
  } catch (err) {
    if (isPortalError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { promoterId: string; slotId: string } },
) {
  try {
    const body = await request.json();
    const { userId, quantity = 1 } = body;
    const db = getDb();
    const entry = await joinWaitlist(params.slotId, userId, params.promoterId, quantity, db);
    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    if (isPortalError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { promoterId: string; slotId: string } },
) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') ?? '';
    const db = getDb();
    await leaveWaitlist(params.slotId, userId, db);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (isPortalError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
