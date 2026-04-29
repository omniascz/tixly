import { NextRequest, NextResponse } from 'next/server';
import { dispatchEvent } from '../../../../services/dispatcher.service';
import { isWebhookError } from '../../../../lib/webhook-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { promoterId, eventType, data } = body;
    const db = getDb();
    const result = await dispatchEvent(
      promoterId ?? '',
      eventType ?? 'booking.created',
      null,
      null,
      data ?? {},
      db,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (isWebhookError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
