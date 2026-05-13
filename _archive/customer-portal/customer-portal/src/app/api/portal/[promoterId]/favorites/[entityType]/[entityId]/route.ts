import { NextRequest, NextResponse } from 'next/server';
import { addFavorite, removeFavorite } from '../../../../../../../services/favorites.service';
import { isPortalError } from '../../../../../../../lib/portal-errors';
import type { EntityType } from '../../../../../../../services/favorites.service';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { promoterId: string; entityType: string; entityId: string } },
) {
  try {
    const body = await request.json();
    const { userId } = body;
    const db = getDb();
    const favorite = await addFavorite(
      userId,
      params.promoterId,
      params.entityType as EntityType,
      params.entityId,
      db,
    );
    return NextResponse.json(favorite, { status: 201 });
  } catch (err) {
    if (isPortalError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { promoterId: string; entityType: string; entityId: string } },
) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') ?? '';
    const db = getDb();
    await removeFavorite(
      userId,
      params.promoterId,
      params.entityType as EntityType,
      params.entityId,
      db,
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    if (isPortalError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
