import { NextRequest, NextResponse } from 'next/server';
import { createWidgetConfig, getWidgetConfig } from '../../../../../../services/widget-config.service';
import { isCinemaProgramError } from '../../../../../../lib/cinema-program-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { venueId: string } },
) {
  try {
    const { searchParams } = new URL(request.url);
    const configKey = searchParams.get('configKey') ?? 'default';
    const db = getDb();
    const config = await getWidgetConfig(params.venueId, configKey, db);
    return NextResponse.json(config);
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { venueId: string } },
) {
  try {
    const body = await request.json() as { configKey: string; [key: string]: unknown };
    const { configKey, ...input } = body;
    const db = getDb();
    const config = await createWidgetConfig(params.venueId, configKey, input, db);
    return NextResponse.json(config, { status: 201 });
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
