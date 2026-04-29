import { NextRequest, NextResponse } from 'next/server';
import { createEndpoint, listEndpoints } from '../../../../services/endpoint.service';
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
    const db = getDb();
    const endpoints = await listEndpoints(promoterId, db);
    return NextResponse.json(endpoints);
  } catch (err) {
    if (isWebhookError(err)) {
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
    const endpoint = await createEndpoint(promoterId, body, db);
    return NextResponse.json(endpoint, { status: 201 });
  } catch (err) {
    if (isWebhookError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
