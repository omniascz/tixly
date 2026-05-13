import { NextRequest, NextResponse } from 'next/server';
import { getCustomerDashboard } from '../../../../../services/dashboard.service';
import { isPortalError } from '../../../../../lib/portal-errors';

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
    const db = getDb();
    const dashboard = await getCustomerDashboard(userId, params.promoterId, db);
    return NextResponse.json(dashboard);
  } catch (err) {
    if (isPortalError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
