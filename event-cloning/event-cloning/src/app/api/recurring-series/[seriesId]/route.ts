import { NextRequest, NextResponse } from 'next/server'
import {
  deactivateSeries,
  getSeriesWithOccurrences,
} from '../../../../services/recurring-events.service.js'
import {
  SeriesNotFoundError,
  UnauthorizedCloneError,
} from '../../../../types/cloning.types.js'
import { getServiceDeps } from '../../../../lib/service-container.js'

function getOrganizerId(req: NextRequest): string | null {
  return req.headers.get('x-user-id')
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ seriesId: string }> },
): Promise<NextResponse> {
  const organizerId = getOrganizerId(request)
  if (organizerId === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { seriesId } = await params
  try {
    const { db } = getServiceDeps()
    const result = await getSeriesWithOccurrences(seriesId, organizerId, db)
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
    console.error('[GET /recurring-series/:id]', err)
    return NextResponse.json({ error: 'InternalServerError' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ seriesId: string }> },
): Promise<NextResponse> {
  const organizerId = getOrganizerId(request)
  if (organizerId === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { seriesId } = await params
  try {
    const { db } = getServiceDeps()
    const series = await deactivateSeries(seriesId, organizerId, db)
    return NextResponse.json({ series }, { status: 200 })
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
    console.error('[DELETE /recurring-series/:id]', err)
    return NextResponse.json({ error: 'InternalServerError' }, { status: 500 })
  }
}
