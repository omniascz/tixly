import { NextRequest, NextResponse } from 'next/server';
import { createCategory, listCategories } from '../../../../services/category.service';
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
    const db = getDb();
    const categories = await listCategories(promoterId, db);
    return NextResponse.json(categories);
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
    const category = await createCategory(promoterId, body, db);
    return NextResponse.json(category, { status: 201 });
  } catch (err) {
    if (isCatalogError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
