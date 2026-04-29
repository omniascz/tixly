import { NextRequest, NextResponse } from 'next/server';
import { getEventLog } from '../../../../services/event-log.service';
import { isWebhookError } from '../../../../lib/webhook-errors';

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
    const filters = {
      eventType: searchParams.get('eventType') ?? undefined,
      dateFrom: searchParams.get('dateFrom') ?? undefined,
      dateTo: searchParams.get('dateTo') ?? undefined,
    };
    const db = getDb();
    const events = await getEventLog(promoterId, filters, db);
    return NextResponse.json(events);
  } catch (err) {
    if (isWebhookError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
