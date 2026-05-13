import { NextRequest, NextResponse } from 'next/server';
import { createService, listServices, searchServices } from '../../../../services/service.service';
import { isCatalogError } from '../../../../lib/catalog-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const promoterId = searchParams.get('promoterId') ?? '';
    const q = searchParams.get('q');
    const db = getDb();

    if (q) {
      const services = await searchServices(promoterId, q, db);
      return NextResponse.json(services);
    }

    const filters = {
      categoryId: searchParams.get('categoryId') ?? undefined,
      branchId: searchParams.get('branchId') ?? undefined,
      isActive: searchParams.has('isActive') ? searchParams.get('isActive') === 'true' : undefined,
      isFeatured: searchParams.has('isFeatured') ? searchParams.get('isFeatured') === 'true' : undefined,
      tags: searchParams.get('tags') ? searchParams.get('tags')!.split(',') : undefined,
      resourceType: searchParams.get('resourceType') ?? undefined,
    };

    const services = await listServices(promoterId, filters, db);
    return NextResponse.json(services);
  } catch (err) {
    if (isCatalogError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const promoterId = searchParams.get('promoterId') ?? '';
    const body = await request.json();
    const db = getDb();
    const service = await createService(promoterId, body, db);
    return NextResponse.json(service, { status: 201 });
  } catch (err) {
    if (isCatalogError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
