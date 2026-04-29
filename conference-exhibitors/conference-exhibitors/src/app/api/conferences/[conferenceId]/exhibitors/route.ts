import { NextRequest, NextResponse } from 'next/server';
import {
  createExhibitor,
  listExhibitors,
  type ExhibitorDB,
  type CreateExhibitorInput,
  type ListExhibitorFilters,
  type ExhibitorStatus,
  type ExhibitorTier,
} from '../../../../../services/exhibitor.service';
import { isExhibitorError } from '../../../../../lib/exhibitor-errors';

function getProductionDb(): ExhibitorDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}

export async function GET(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string }; db?: ExhibitorDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const { searchParams } = new URL(request.url);
    const filters: ListExhibitorFilters = {};
    const status = searchParams.get('status');
    if (status) filters.status = status as ExhibitorStatus;
    const tier = searchParams.get('tier');
    if (tier) filters.tier = tier as ExhibitorTier;

    const exhibitors = await listExhibitors(params.conferenceId, filters, resolvedDb);
    return NextResponse.json(exhibitors);
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string }; db?: ExhibitorDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as CreateExhibitorInput;
    const exhibitor = await createExhibitor(params.conferenceId, body, resolvedDb);
    return NextResponse.json(exhibitor, { status: 201 });
  } catch (err) {
    if (isExhibitorError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
