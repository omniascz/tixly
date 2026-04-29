import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cloneEvent } from '../../../../../services/event-cloning.service'
import {
  CloneValidationError,
  EventNotFoundError,
  UnauthorizedCloneError,
} from '../../../../../types/cloning.types'
import { getServiceDeps } from '../../../../../lib/service-container'

// ─── Request schema ───────────────────────────────────────────────────────────

const CloneRequestSchema = z.object({
  newDateStart: z.string().datetime({ message: 'newDateStart musí být ISO datum.' }),
  newDateEnd: z.string().datetime({ message: 'newDateEnd musí být ISO datum.' }),
  newTitle: z.string().min(1).max(255).optional(),
  onSaleAt: z.string().datetime().optional(),
  offSaleAt: z.string().datetime().optional(),
  resetPricing: z.boolean().optional(),
  cloneTicketTypes: z.boolean().optional(),
  clonePricingRules: z.boolean().optional(),
})

type CloneRequest = z.infer<typeof CloneRequestSchema>

// ─── Auth helper ──────────────────────────────────────────────────────────────

/**
 * Extract organizer ID from the JWT contained in the Authorization header.
 *
 * Replace with your real JWT-verification logic (e.g. jose, jsonwebtoken).
 * Returns null when the token is missing or invalid.
 */
function getOrganizerId(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  try {
    // In production: verify(token, JWT_SECRET) and return payload.sub
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
 * POST /api/events/[eventId]/clone
 *
 * Clone a single event with new dates.
 *
 * Auth: Bearer JWT — organizer must own the event.
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

  const parsed = CloneRequestSchema.safeParse(body)
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

  const data: CloneRequest = parsed.data

  // ── Convert ISO strings → Date objects ────────────────────────────────────
  const options = {
    newDateStart: new Date(data.newDateStart),
    newDateEnd: new Date(data.newDateEnd),
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
    const result = await cloneEvent(eventId, organizerId, options, db)

    return NextResponse.json(
      {
        newEventId: result.newEventId,
        clonedTicketTypes: result.clonedTicketTypes,
        clonedPricingRules: result.clonedPricingRules,
        warnings: result.warnings,
        previewUrl: `/events/${result.newEventId}/edit`,
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof CloneValidationError) {
      return NextResponse.json(
        {
          error: 'CloneValidationError',
          message: 'Chyby validace klonování.',
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

    // Unexpected error — do not leak internals
    console.error('[POST /api/events/[eventId]/clone] Unexpected error:', err)
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Interní chyba serveru.' },
      { status: 500 },
    )
  }
}
