import { NextRequest, NextResponse } from 'next/server';
import {
  getTicketContent,
  upsertTicketContent,
  publishTicketContent,
  deleteTicketContent,
} from '../../../../../services/ticket-content.service.js';

function getDb() {
  // Placeholder — injected from service-container in production
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<T[]> => [],
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

// GET /api/events/[eventId]/ticket-content
export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  const promoterId = request.headers.get('x-promoter-id');
  if (!promoterId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const content = await getTicketContent(params.eventId, promoterId, getDb());
  if (!content) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json(content);
}

// PUT /api/events/[eventId]/ticket-content
export async function PUT(
  request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  const promoterId = request.headers.get('x-promoter-id');
  if (!promoterId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  try {
    const content = await upsertTicketContent(params.eventId, promoterId, body as Parameters<typeof upsertTicketContent>[2], getDb());
    return NextResponse.json(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    if (msg.startsWith('VALIDATION_ERROR')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

// POST /api/events/[eventId]/ticket-content/publish
export async function POST(
  request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  const promoterId = request.headers.get('x-promoter-id');
  if (!promoterId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const url = new URL(request.url);
  if (!url.pathname.endsWith('/publish')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  try {
    const content = await publishTicketContent(params.eventId, promoterId, getDb());
    return NextResponse.json(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.startsWith('NOT_FOUND')) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

// DELETE /api/events/[eventId]/ticket-content
export async function DELETE(
  request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  const promoterId = request.headers.get('x-promoter-id');
  if (!promoterId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  await deleteTicketContent(params.eventId, promoterId, getDb());
  return new NextResponse(null, { status: 204 });
}
