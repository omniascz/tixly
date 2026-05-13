import { NextRequest, NextResponse } from 'next/server';
import { enableService, getAvailableServices } from '../../../../../../services/branch-services.service';
import { isBranchError } from '../../../../../../lib/branch-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { branchId: string } },
) {
  try {
    const db = getDb();
    const services = await getAvailableServices(params.branchId, db);
    return NextResponse.json(services);
  } catch (err) {
    if (isBranchError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { branchId: string } },
) {
  try {
    const body = await request.json();
    const db = getDb();
    const availability = await enableService(params.branchId, body.serviceId, body.priceOverrideHellers ?? null, db);
    return NextResponse.json(availability, { status: 201 });
  } catch (err) {
    if (isBranchError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
