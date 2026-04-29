import { NextRequest, NextResponse } from 'next/server';
import type {
  OrderCompletedKafkaEvent,
  OrderCreatedKafkaEvent,
  PageViewedKafkaEvent,
  ServiceDeps,
} from '../../../../types/tracking.types.js';
import * as orchestrator from '../../../../services/tracking-orchestrator.service.js';

type TrackingEventType = 'OrderCompleted' | 'PageViewed' | 'OrderCreated';

interface TrackingEventRequest {
  type: TrackingEventType;
  payload: OrderCompletedKafkaEvent | PageViewedKafkaEvent | OrderCreatedKafkaEvent;
}

const VALID_EVENT_TYPES: ReadonlySet<string> = new Set([
  'OrderCompleted',
  'PageViewed',
  'OrderCreated',
]);

/**
 * POST /api/tracking/events
 * Manual event submission endpoint for cases where Kafka is not used.
 * Requires INTERNAL_API_KEY header for authentication.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const apiKey = request.headers.get('x-api-key');
    const expectedKey = process.env['INTERNAL_API_KEY'];

    if (!expectedKey || apiKey !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const { type, payload } = body as TrackingEventRequest;

    if (!type || !VALID_EVENT_TYPES.has(type)) {
      return NextResponse.json(
        { error: `Invalid event type. Must be one of: ${[...VALID_EVENT_TYPES].join(', ')}` },
        { status: 400 },
      );
    }

    if (!payload || typeof payload !== 'object') {
      return NextResponse.json(
        { error: 'Missing or invalid payload' },
        { status: 400 },
      );
    }

    // TODO: Inject ServiceDeps from application context
    const deps: ServiceDeps = null as unknown as ServiceDeps;

    switch (type) {
      case 'OrderCompleted':
        await orchestrator.handleOrderCompleted(payload as OrderCompletedKafkaEvent, deps);
        break;
      case 'PageViewed':
        await orchestrator.handlePageViewed(payload as PageViewedKafkaEvent, deps);
        break;
      case 'OrderCreated':
        await orchestrator.handleOrderCreated(payload as OrderCreatedKafkaEvent, deps);
        break;
    }

    return NextResponse.json(
      { message: 'Event processed successfully', type },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[POST /api/tracking/events] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process tracking event', detail: message },
      { status: 500 },
    );
  }
}
