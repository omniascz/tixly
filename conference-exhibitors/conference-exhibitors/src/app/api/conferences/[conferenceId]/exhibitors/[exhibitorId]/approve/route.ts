import { NextRequest, NextResponse } from 'next/server';
import {
  approveExhibitor,
  type ExhibitorDB,
} from '../../../../../../../services/exhibitor.service';
import { isExhibitorError } from '../../../../../../../lib/exhibitor-errors';

function getProductionDb(): ExhibitorDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}

export async function POST(
  _request: NextRequest,
  { params, db }: { params: { conferenceId: string; exhibitorId: string }; db?: ExhibitorDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const exhibitor = await approveExhibitor(params.exhibitorId, resolvedDb);
    return NextResponse.json(exhibitor);
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
