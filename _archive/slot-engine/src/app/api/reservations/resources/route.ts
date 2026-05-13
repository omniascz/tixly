import { NextRequest, NextResponse } from 'next/server';
import { createResource, listResources } from '../../../../services/resource.service';
import { isSlotError } from '../../../../lib/slot-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const promoterId = searchParams.get('promoterId');
    if (!promoterId) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'promoterId is required' }, { status: 400 });
    }
    const filters = {
      branchId: searchParams.get('branchId') ?? undefined,
      resourceType: searchParams.get('resourceType') ?? undefined,
      isActive: searchParams.has('isActive') ? searchParams.get('isActive') === 'true' : undefined,
    };
    const db = getDb();
    const resources = await listResources(promoterId, filters, db);
    return NextResponse.json({ resources });
  } catch (err) {
    if (isSlotError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { promoterId: string; [key: string]: unknown };
    const { promoterId, ...input } = body;
    const db = getDb();
    const resource = await createResource(promoterId, input as Parameters<typeof createResource>[1], db);
    return NextResponse.json(resource, { status: 201 });
  } catch (err) {
    if (isSlotError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
