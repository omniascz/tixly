import { NextRequest, NextResponse } from 'next/server';
import {
  updateAllocation,
  pushToChannel,
  pullFromChannel,
} from '../../../../../../services/channel-distribution.service.js';
import type { ChannelAdapter } from '../../../../../../services/channel-distribution.service.js';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<T[]> => [],
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
    transaction: async <T>(fn: (tx: ReturnType<typeof getDb>) => Promise<T>) => fn(getDb()),
  };
}

function getChannelAdapter(_channelId: string): ChannelAdapter {
  // Placeholder — real adapters injected from service-container in production
  return {
    pushAvailability: async () => ({ externalEventId: '' }),
    pullSoldQty: async () => 0,
  };
}

// PATCH /api/events/[eventId]/channels/[allocationId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: { eventId: string; allocationId: string } },
): Promise<NextResponse> {
  const promoterId = request.headers.get('x-promoter-id');
  if (!promoterId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  try {
    const allocation = await updateAllocation(params.allocationId, promoterId, body as Parameters<typeof updateAllocation>[2], getDb());
    return NextResponse.json(allocation);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.startsWith('NOT_FOUND')) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    if (msg.startsWith('VALIDATION_ERROR')) return NextResponse.json({ error: msg }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

// POST /api/events/[eventId]/channels/[allocationId]/sync?direction=push|pull
export async function POST(
  request: NextRequest,
  { params }: { params: { eventId: string; allocationId: string } },
): Promise<NextResponse> {
  const promoterId = request.headers.get('x-promoter-id');
  if (!promoterId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const direction = new URL(request.url).searchParams.get('direction') ?? 'push';

  try {
    const db = getDb();
    // Fetch allocation to get channelId for adapter lookup
    const allocs = await db.query<{ channel_id: string }>(`SELECT channel_id FROM channels.event_channel_allocations WHERE id = $1`, [params.allocationId]);
    const channelId = allocs[0]?.channel_id ?? 'unknown';
    const adapter = getChannelAdapter(channelId);

    const result = direction === 'pull'
      ? await pullFromChannel(params.allocationId, promoterId, adapter, db)
      : await pushToChannel(params.allocationId, promoterId, adapter, db);

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.startsWith('NOT_FOUND')) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    if (msg.startsWith('VALIDATION_ERROR')) return NextResponse.json({ error: msg }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
