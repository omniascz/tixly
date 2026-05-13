import { NextRequest, NextResponse } from 'next/server';
import { createPackage, listPackages } from '../../../../services/package.service';
import { isPackageError } from '../../../../lib/package-errors';

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
    const db = getDb();

    const filters = {
      packageType: (searchParams.get('packageType') ?? undefined) as Parameters<typeof listPackages>[1]['packageType'],
      isActive: searchParams.has('isActive') ? searchParams.get('isActive') === 'true' : undefined,
      isFeatured: searchParams.has('isFeatured') ? searchParams.get('isFeatured') === 'true' : undefined,
      branchId: searchParams.get('branchId') ?? undefined,
    };

    const packages = await listPackages(promoterId, filters, db);
    return NextResponse.json(packages);
  } catch (err) {
    if (isPackageError(err)) {
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
    const pkg = await createPackage(promoterId, body, db);
    return NextResponse.json(pkg, { status: 201 });
  } catch (err) {
    if (isPackageError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
