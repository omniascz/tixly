import { NextRequest, NextResponse } from 'next/server';
import {
  createFloorMap,
  listFloorMaps,
  type FloorMapDB,
  type CreateFloorMapInput,
} from '../../../../../services/floor-map.service';
import { isExhibitorError } from '../../../../../lib/exhibitor-errors';

function getProductionDb(): FloorMapDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}

export async function GET(
  _request: NextRequest,
  { params, db }: { params: { conferenceId: string }; db?: FloorMapDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const maps = await listFloorMaps(params.conferenceId, resolvedDb);
    return NextResponse.json(maps);
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string }; db?: FloorMapDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as CreateFloorMapInput;
    const map = await createFloorMap(params.conferenceId, body, resolvedDb);
    return NextResponse.json(map, { status: 201 });
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
