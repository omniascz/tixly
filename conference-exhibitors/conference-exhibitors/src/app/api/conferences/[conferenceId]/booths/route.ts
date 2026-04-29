import { NextRequest, NextResponse } from 'next/server';
import {
  createBooth,
  listBooths,
  type BoothDB,
  type CreateBoothInput,
  type ListBoothFilters,
  type BoothStatus,
} from '../../../../../services/booth.service';
import { isExhibitorError } from '../../../../../lib/exhibitor-errors';

function getProductionDb(): BoothDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}

export async function GET(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string }; db?: BoothDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const { searchParams } = new URL(request.url);
    const filters: ListBoothFilters = {};
    const status = searchParams.get('status');
    if (status) filters.status = status as BoothStatus;
    const categoryId = searchParams.get('categoryId');
    if (categoryId) filters.categoryId = categoryId;
    const floorMapId = searchParams.get('floorMapId');
    if (floorMapId) filters.floorMapId = floorMapId;

    const booths = await listBooths(params.conferenceId, filters, resolvedDb);
    return NextResponse.json(booths);
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string }; db?: BoothDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as CreateBoothInput;
    const booth = await createBooth(params.conferenceId, body, resolvedDb);
    return NextResponse.json(booth, { status: 201 });
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
