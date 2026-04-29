import { NextRequest, NextResponse } from 'next/server';
import {
  getFloorMapWithBooths,
  updateFloorMap,
  type FloorMapDB,
  type UpdateFloorMapInput,
} from '../../../../../../services/floor-map.service';
import { isExhibitorError } from '../../../../../../lib/exhibitor-errors';

function getProductionDb(): FloorMapDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}

export async function GET(
  _request: NextRequest,
  { params, db }: { params: { conferenceId: string; mapId: string }; db?: FloorMapDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const map = await getFloorMapWithBooths(params.mapId, resolvedDb);
    return NextResponse.json(map);
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function PATCH(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string; mapId: string }; db?: FloorMapDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as UpdateFloorMapInput;
    const map = await updateFloorMap(params.mapId, body, resolvedDb);
    return NextResponse.json(map);
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
