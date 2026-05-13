import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceDeps } from '../../../../../lib/service-container.js'
import { willCallService } from '../../../../../services/will-call.service.js'
import {
  WillCallNotFoundError,
  WillCallAlreadyPickedUpError,
  WillCallForfeitedError,
  WillCallWindowClosedError,
} from '../../../../../types/will-call.types.js'

const BodySchema = z.object({
  staff_id: z.string().min(1),
  lang: z.enum(['cs', 'en']).optional().default('cs'),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entryId: string }> },
): Promise<NextResponse> {
  const staffId = request.headers.get('x-staff-id')
  if (!staffId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawBody = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const { entryId } = await params
  const { db } = getServiceDeps()
  const lang = parsed.data.lang ?? 'cs'

  try {
    const entry = await willCallService.recordPickup(entryId, staffId, db)

    const confirmation =
      lang === 'cs'
        ? `Vstupenka pro ${entry.holder_name} byla úspěšně vydána.`
        : `Ticket for ${entry.holder_name} has been successfully issued.`

    return NextResponse.json({ entry, confirmation })
  } catch (err) {
    if (err instanceof WillCallNotFoundError) {
      return NextResponse.json({ error: 'Not found', code: 'WILL_CALL_NOT_FOUND' }, { status: 404 })
    }
    if (err instanceof WillCallAlreadyPickedUpError) {
      return NextResponse.json({ code: 'WILL_CALL_ALREADY_PICKED_UP' }, { status: 409 })
    }
    if (err instanceof WillCallForfeitedError) {
      return NextResponse.json({ code: 'WILL_CALL_FORFEITED' }, { status: 410 })
    }
    if (err instanceof WillCallWindowClosedError) {
      return NextResponse.json({ code: 'WILL_CALL_WINDOW_CLOSED' }, { status: 400 })
    }
    throw err
  }
}
