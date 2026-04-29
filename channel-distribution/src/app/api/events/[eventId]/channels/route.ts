import { NextRequest, NextResponse } from 'next/server';
import {
  createAllocation,
  listAllocations,
} from '../../../../../services/channel-distribution.service.js';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<T[]> => [],
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
    transaction: async <T>(fn: (tx: ReturnType<typeof getDb>) => Promise<T>) => fn(getDb()),
  };
}

// GET /api/events/[eventId]/channels
export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  const promoterId = request.headers.get('x-promoter-id');
  if (!promoterId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const allocations = await listAllocations(params.eventId, promoterId, getDb());
  return NextResponse.json(allocations);
}

// POST /api/events/[eventId]/channels
export async function POST(
  request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  const promoterId = request.headers.get('x-promoter-id');
  if (!promoterId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  try {
    const allocation = await createAllocation(params.eventId, promoterId, body as Parameters<typeof createAllocation>[2], getDb());
    return NextResponse.json(allocation, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    if (msg.startsWith('VALIDATION_ERROR')) return NextResponse.json({ error: msg }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
