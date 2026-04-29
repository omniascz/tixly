import { NextRequest, NextResponse } from 'next/server';
import { getWidgetData } from '../../../../../../../services/program-view.service';
import { updateWidgetConfig } from '../../../../../../../services/widget-config.service';
import { isCinemaProgramError } from '../../../../../../../lib/cinema-program-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { venueId: string; configKey: string } },
) {
  try {
    const db = getDb();
    const data = await getWidgetData(params.venueId, params.configKey, db);
    return NextResponse.json(data);
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { venueId: string; configKey: string } },
) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const db = getDb();
    const config = await updateWidgetConfig(params.venueId, params.configKey, body, db);
    return NextResponse.json(config);
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
