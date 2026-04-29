import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cloneEventSeries } from '../../../../../services/event-cloning.service'
import {
  CloneValidationError,
  EventNotFoundError,
  UnauthorizedCloneError,
} from '../../../../../types/cloning.types'
import { MAX_SERIES_CLONES } from '../../../../../lib/clone-validator'
import { getServiceDeps } from '../../../../../lib/service-container'

// ─── Request schema ───────────────────────────────────────────────────────────

const SeriesDateSchema = z.object({
  dateStart: z.string().datetime({ message: 'dateStart musí být ISO datum.' }),
  dateEnd: z.string().datetime({ message: 'dateEnd musí být ISO datum.' }),
})

const CloneSeriesRequestSchema = z.object({
  dates: z
    .array(SeriesDateSchema)
    .min(1, 'Musí být zadáno alespoň jedno datum.')
    .max(
      MAX_SERIES_CLONES,
      `Maximální počet datumů je ${MAX_SERIES_CLONES}.`,
    ),
  newTitle: z.string().min(1).max(255).optional(),
  onSaleAt: z.string().datetime().optional(),
  offSaleAt: z.string().datetime().optional(),
  resetPricing: z.boolean().optional(),
  cloneTicketTypes: z.boolean().optional(),
  clonePricingRules: z.boolean().optional(),
})

type CloneSeriesRequest = z.infer<typeof CloneSeriesRequestSchema>

// ─── Auth helper ──────────────────────────────────────────────────────────────

function getOrganizerId(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  try {
    const token = authHeader.slice(7)
    const payloadBase64 = token.split('.')[1]
    if (!payloadBase64) return null
    const payload = JSON.parse(
      Buffer.from(payloadBase64, 'base64url').toString('utf8'),
    ) as { sub?: string; organizer_id?: string }
    return payload.organizer_id ?? payload.sub ?? null
  } catch {
    return null
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * POST /api/events/[eventId]/clone-series
 *
 * Clone the same event for multiple dates (e.g. entire theatre season).
 * Max {@link MAX_SERIES_CLONES} dates per request.
 *
 * Auth: Bearer JWT — organizer must own the event.
 *
 * Failures for individual dates are collected in `failed[]` and do NOT abort
 * the remaining clones.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const organizerId = getOrganizerId(request)
  if (organizerId === null) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Platný Bearer token je povinný.' },
      { status: 401 },
    )
  }

  // ── Params ────────────────────────────────────────────────────────────────
  const { eventId } = await params

  // ── Body parsing & Zod validation ─────────────────────────────────────────
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'BadRequest', message: 'Tělo požadavku musí být platné JSON.' },
      { status: 400 },
    )
  }

  const parsed = CloneSeriesRequestSchema.safeParse(body)
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

  const data: CloneSeriesRequest = parsed.data

  // ── Convert ISO strings → Date objects ────────────────────────────────────
  const dates = data.dates.map(({ dateStart, dateEnd }) => ({
    dateStart: new Date(dateStart),
    dateEnd: new Date(dateEnd),
  }))

  const sharedOptions = {
    newTitle: data.newTitle,
    onSaleAt: data.onSaleAt ? new Date(data.onSaleAt) : undefined,
    offSaleAt: data.offSaleAt ? new Date(data.offSaleAt) : undefined,
    resetPricing: data.resetPricing,
    cloneTicketTypes: data.cloneTicketTypes,
    clonePricingRules: data.clonePricingRules,
  }

  // ── Execute ───────────────────────────────────────────────────────────────
  try {
    const { db } = getServiceDeps()
    const result = await cloneEventSeries(
      eventId,
      organizerId,
      dates,
      sharedOptions,
      db,
    )

    return NextResponse.json(
      {
        created: result.created,
        failed: result.failed,
        total: result.total,
        succeeded: result.succeeded,
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof CloneValidationError) {
      return NextResponse.json(
        {
          error: 'CloneValidationError',
          message: 'Chyby validace klonování série.',
          details: err.validationErrors,
        },
        { status: 422 },
      )
    }

    if (err instanceof EventNotFoundError) {
      return NextResponse.json(
        {
          error: 'EventNotFoundError',
          message: `Akce '${err.eventId}' nebyla nalezena.`,
        },
        { status: 404 },
      )
    }

    if (err instanceof UnauthorizedCloneError) {
      return NextResponse.json(
        {
          error: 'UnauthorizedCloneError',
          message: 'Nemáte oprávnění klonovat tuto akci.',
        },
        { status: 403 },
      )
    }

    console.error(
      '[POST /api/events/[eventId]/clone-series] Unexpected error:',
      err,
    )
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Interní chyba serveru.' },
      { status: 500 },
    )
  }
}
