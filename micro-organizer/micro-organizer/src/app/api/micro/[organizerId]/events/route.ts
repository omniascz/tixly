import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { CreateMicroEventSchema } from '../../../../../lib/zod-schemas.js';
import {
  createMicroEvent,
  listMicroEvents,
} from '../../../../../services/micro-organizer.service.js';
import { isMicroOrganizerError } from '../../../../../lib/micro-organizer-errors.js';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import type { ServiceDeps } from '../../../../../lib/service-container.js';

// ---------------------------------------------------------------------------
// GET /api/micro/[organizerId]/events — seznam akcí pořadatele
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  context: { params: { organizerId: string }; deps?: ServiceDeps },
): Promise<NextResponse> {
  const deps: ServiceDeps = context?.deps ?? getServiceDeps();
  const { organizerId } = context.params;

  try {
    const events = await listMicroEvents(organizerId, deps);
    return NextResponse.json({ events }, { status: 200 });
  } catch (err) {
    if (isMicroOrganizerError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// POST /api/micro/[organizerId]/events — vytvoření nové akce
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  context: { params: { organizerId: string }; deps?: ServiceDeps },
): Promise<NextResponse> {
  const deps: ServiceDeps = context?.deps ?? getServiceDeps();
  const { organizerId } = context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: 'Neplatné tělo požadavku.' },
      { status: 400 },
    );
  }

  let input;
  try {
    input = CreateMicroEventSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Neplatný vstup.', details: err.errors },
        { status: 400 },
      );
    }
    throw err;
  }

  try {
    const result = await createMicroEvent(organizerId, input, deps);
    return NextResponse.json(
      {
        eventId: result.eventId,
        ticketUrl: result.ticketUrl,
        message: 'Akce byla úspěšně zveřejněna.',
      },
      { status: 201 },
    );
  } catch (err) {
    if (isMicroOrganizerError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
