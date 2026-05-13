import { NextRequest, NextResponse } from 'next/server';
import {
  getExhibitor,
  updateExhibitor,
  type ExhibitorDB,
  type UpdateExhibitorInput,
} from '../../../../../../services/exhibitor.service';
import { isExhibitorError } from '../../../../../../lib/exhibitor-errors';

function getProductionDb(): ExhibitorDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}

export async function GET(
  _request: NextRequest,
  { params, db }: { params: { conferenceId: string; exhibitorId: string }; db?: ExhibitorDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const exhibitor = await getExhibitor(params.exhibitorId, resolvedDb);
    return NextResponse.json(exhibitor);
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function PATCH(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string; exhibitorId: string }; db?: ExhibitorDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as UpdateExhibitorInput;
    const exhibitor = await updateExhibitor(params.exhibitorId, body, resolvedDb);
    return NextResponse.json(exhibitor);
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
