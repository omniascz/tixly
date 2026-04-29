import { NextRequest, NextResponse } from 'next/server';
import {
  getBooth,
  updateBooth,
  type BoothDB,
  type UpdateBoothInput,
} from '../../../../../../services/booth.service';
import { isExhibitorError } from '../../../../../../lib/exhibitor-errors';

function getProductionDb(): BoothDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}

export async function GET(
  _request: NextRequest,
  { params, db }: { params: { conferenceId: string; boothId: string }; db?: BoothDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const booth = await getBooth(params.boothId, resolvedDb);
    return NextResponse.json(booth);
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function PATCH(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string; boothId: string }; db?: BoothDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as UpdateBoothInput;
    const booth = await updateBooth(params.boothId, body, resolvedDb);
    return NextResponse.json(booth);
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
