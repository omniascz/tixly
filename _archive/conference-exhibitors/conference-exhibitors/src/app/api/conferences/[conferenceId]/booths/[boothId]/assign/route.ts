import { NextRequest, NextResponse } from 'next/server';
import {
  assignBooth,
  unassignBooth,
  type BoothDB,
  type AssignBoothInput,
} from '../../../../../../../services/booth.service';
import { isExhibitorError } from '../../../../../../../lib/exhibitor-errors';

function getProductionDb(): BoothDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}

export async function POST(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string; boothId: string }; db?: BoothDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as { exhibitorId: string } & AssignBoothInput;
    const booth = await assignBooth(params.boothId, body.exhibitorId, body, resolvedDb);
    return NextResponse.json(booth);
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function DELETE(
  _request: NextRequest,
  { params, db }: { params: { conferenceId: string; boothId: string }; db?: BoothDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    await unassignBooth(params.boothId, resolvedDb);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
