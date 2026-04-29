import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createRecurringSeries,
  getSeriesWithOccurrences,
} from '../../../../../services/recurring-events.service.js'
import {
  InvalidRRuleError,
  ParentEventNotFoundError,
  SeriesNotFoundError,
  UnauthorizedCloneError,
} from '../../../../../types/cloning.types.js'
import { getServiceDeps } from '../../../../../lib/service-container.js'

const CreateSeriesSchema = z.object({
  rrule: z.string().min(1),
  publishWindowDays: z.number().int().positive().max(365),
  maxOccurrences: z.number().int().positive().optional(),
  initialStatus: z.enum(['draft', 'published']).optional(),
})

function getOrganizerId(req: NextRequest): string | null {
  return req.headers.get('x-user-id')
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  const organizerId = getOrganizerId(request)
  if (organizerId === null) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'x-user-id header is required.' },
      { status: 401 },
    )
  }

  const { eventId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'BadRequest', message: 'Tělo požadavku musí být platné JSON.' },
      { status: 400 },
    )
  }

  const parsed = CreateSeriesSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'ValidationError',
        message: 'Neplatná data požadavku.',
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 422 },
    )
  }

  try {
    const { db } = getServiceDeps()
    const result = await createRecurringSeries(
      {
        parentEventId: eventId,
        rrule: parsed.data.rrule,
        publishWindowDays: parsed.data.publishWindowDays,
        maxOccurrences: parsed.data.maxOccurrences,
        initialStatus: parsed.data.initialStatus,
      },
      organizerId,
      db,
    )
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof InvalidRRuleError) {
      return NextResponse.json(
        { error: 'InvalidRRuleError', message: err.message },
        { status: 422 },
      )
    }
    if (err instanceof ParentEventNotFoundError) {
      return NextResponse.json(
        { error: 'ParentEventNotFoundError', message: err.message },
        { status: 404 },
      )
    }
    if (err instanceof UnauthorizedCloneError) {
      return NextResponse.json(
        { error: 'UnauthorizedCloneError', message: err.message },
        { status: 403 },
      )
    }
    console.error('[POST recurring-series] Unexpected:', err)
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Interní chyba serveru.' },
      { status: 500 },
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  const organizerId = getOrganizerId(request)
  if (organizerId === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { eventId } = await params

  try {
    const { db } = getServiceDeps()
    const seriesRow = await db.queryOne<{ id: string }>(
      `SELECT id FROM platform.recurring_series WHERE parent_event_id = $1`,
      [eventId],
    )
    if (seriesRow === null) {
      return NextResponse.json(
        { error: 'SeriesNotFoundError', message: 'Series not found.' },
        { status: 404 },
      )
    }
    const result = await getSeriesWithOccurrences(
      seriesRow.id,
      organizerId,
      db,
    )
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof SeriesNotFoundError) {
      return NextResponse.json(
        { error: 'SeriesNotFoundError', message: err.message },
        { status: 404 },
      )
    }
    if (err instanceof UnauthorizedCloneError) {
      return NextResponse.json(
        { error: 'UnauthorizedCloneError', message: err.message },
        { status: 403 },
      )
    }
    console.error('[GET recurring-series] Unexpected:', err)
    return NextResponse.json(
      { error: 'InternalServerError' },
      { status: 500 },
    )
  }
}
