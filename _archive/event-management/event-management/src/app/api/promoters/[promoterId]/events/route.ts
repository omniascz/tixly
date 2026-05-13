import { NextRequest, NextResponse } from 'next/server';
import { CreateEventSchema } from '../../../../../lib/zod-schemas';
import { createEvent, listEvents } from '../../../../../services/event.service';
import { EventManagementError } from '../../../../../lib/event-errors';
import type { ServiceDeps } from '../../../../../lib/service-container';
import type { EventStatus } from '../../../../../types/event';

// ---------------------------------------------------------------------------
// Deps factory — přepsatelná v testech
// ---------------------------------------------------------------------------
export let _getDeps: () => ServiceDeps = () => {
  throw new Error('DB adapter not configured — inject via _getDeps');
};

export function _setDeps(factory: () => ServiceDeps): void {
  _getDeps = factory;
}

// ---------------------------------------------------------------------------
// GET /api/promoters/[promoterId]/events
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: { promoterId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Chybí x-user-id header.' } },
      { status: 401 },
    );
  }

  const { promoterId } = params;
  const { searchParams } = new URL(request.url);

  const status = searchParams.get('status') as EventStatus | null;
  const search = searchParams.get('search') ?? undefined;
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const limit = parseInt(searchParams.get('limit') ?? '20', 10);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  const from = fromParam ? new Date(fromParam) : undefined;
  const to = toParam ? new Date(toParam) : undefined;

  try {
    const result = await listEvents(
      promoterId,
      { status: status ?? undefined, search, from, to },
      { limit, offset },
      _getDeps(),
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof EventManagementError) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// POST /api/promoters/[promoterId]/events
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: { promoterId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Chybí x-user-id header.' } },
      { status: 401 },
    );
  }

  const { promoterId } = params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Tělo požadavku není platný JSON.' } },
      { status: 400 },
    );
  }

  const parseResult = CreateEventSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0]?.message ?? 'Neplatná data.' } },
      { status: 400 },
    );
  }

  try {
    const event = await createEvent(promoterId, parseResult.data, _getDeps());
    return NextResponse.json(event, { status: 201 });
  } catch (err) {
    if (err instanceof EventManagementError) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
