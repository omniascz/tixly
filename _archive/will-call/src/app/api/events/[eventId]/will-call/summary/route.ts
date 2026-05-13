import { NextRequest, NextResponse } from 'next/server'
import { getServiceDeps } from '../../../../../../lib/service-container.js'
import { willCallService } from '../../../../../../services/will-call.service.js'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  const staffId = request.headers.get('x-staff-id')
  if (!staffId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { eventId } = await params
  const { db } = getServiceDeps()
  const summary = await willCallService.getEventSummary(eventId, db)

  return NextResponse.json(summary)
}
