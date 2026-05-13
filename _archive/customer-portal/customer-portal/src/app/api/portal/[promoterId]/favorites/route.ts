import { NextRequest, NextResponse } from 'next/server';
import { getFavorites } from '../../../../../services/favorites.service';
import { isPortalError } from '../../../../../lib/portal-errors';
import type { EntityType } from '../../../../../services/favorites.service';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { promoterId: string } },
) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') ?? '';
    const entityType = (searchParams.get('entityType') ?? undefined) as EntityType | undefined;
    const db = getDb();
    const favorites = await getFavorites(userId, params.promoterId, entityType, db);
    return NextResponse.json(favorites);
  } catch (err) {
    if (isPortalError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
