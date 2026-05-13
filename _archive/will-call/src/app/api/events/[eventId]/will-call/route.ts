import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceDeps } from '../../../../../lib/service-container.js'
import { willCallService } from '../../../../../services/will-call.service.js'
import type { WillCallStatus } from '../../../../../types/will-call.types.js'

const VALID_STATUSES: WillCallStatus[] = ['reserved', 'ready_for_pickup', 'picked_up', 'forfeited']

const RegisterSchema = z.object({
  ticket_id: z.string().min(1),
  order_id: z.string().min(1),
  holder_name: z.string().min(1),
  holder_email: z.string().email(),
  ticket_type_name: z.string().min(1),
  holder_phone: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  pickup_location: z.string().optional(),
  pickup_window_start: z.string().optional(),
  pickup_window_end: z.string().optional(),
  notes: z.string().optional(),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  const staffId = request.headers.get('x-staff-id')
  if (!staffId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { eventId } = await params
  const url = new URL(request.url)
  const q = url.searchParams.get('q') ?? ''
  const statusParam = url.searchParams.get('status') ?? undefined

  if (statusParam && !VALID_STATUSES.includes(statusParam as WillCallStatus)) {
    return NextResponse.json({ error: `Invalid status: ${statusParam}` }, { status: 400 })
  }

  const { db } = getServiceDeps()
  const result = await willCallService.searchGuests(
    eventId,
    q,
    statusParam as WillCallStatus | undefined,
    db,
  )

  return NextResponse.json(result)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  const staffId = request.headers.get('x-staff-id') ?? request.headers.get('x-user-id')
  if (!staffId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawBody = await request.json().catch(() => null)
  const parsed = RegisterSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const { eventId } = await params
  const { db } = getServiceDeps()
  const data = parsed.data

  const entry = await willCallService.registerForWillCall(
    data.ticket_id,
    eventId,
    { name: data.holder_name, email: data.holder_email, phone: data.holder_phone },
    {
      quantity: data.quantity,
      pickupLocation: data.pickup_location,
      pickupWindowStart: data.pickup_window_start ? new Date(data.pickup_window_start) : undefined,
      pickupWindowEnd: data.pickup_window_end ? new Date(data.pickup_window_end) : undefined,
      notes: data.notes,
    },
    db,
  )

  return NextResponse.json(entry, { status: 201 })
}
