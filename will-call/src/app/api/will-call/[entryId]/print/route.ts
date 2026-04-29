import { NextRequest, NextResponse } from 'next/server'
import { getServiceDeps } from '../../../../../lib/service-container.js'
import {
  WillCallNotFoundError,
  WillCallAlreadyPickedUpError,
} from '../../../../../types/will-call.types.js'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entryId: string }> },
): Promise<NextResponse> {
  const staffId = request.headers.get('x-staff-id')
  if (!staffId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { entryId } = await params
  const { db } = getServiceDeps()

  const entry = await db.findEntryById(entryId)
  if (!entry) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (entry.status === 'picked_up') {
    return NextResponse.json({ code: 'WILL_CALL_ALREADY_PICKED_UP' }, { status: 400 })
  }
  if (entry.status === 'forfeited') {
    return NextResponse.json({ code: 'WILL_CALL_FORFEITED' }, { status: 400 })
  }

  const printedAt = new Date()
  await db.updateEntry(entryId, {
    pickup_printed_at: printedAt,
    pickup_printed_by: staffId,
  })

  return NextResponse.json({
    printUrl: `/api/tickets/${entry.ticket_id}/pdf`,
    printedAt: printedAt.toISOString(),
  })
}
