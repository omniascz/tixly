import { NextRequest, NextResponse } from 'next/server'
import { getServiceDeps } from '../../../../../lib/service-container.js'

const E164_RE = /^\+\d{7,15}$/

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

  const body = await request.json().catch(() => ({}))
  const phone: string | null = (body as { phone?: string }).phone ?? entry.holder_phone ?? null

  if (!phone || !E164_RE.test(phone)) {
    return NextResponse.json({ code: 'WILL_CALL_PHONE_REQUIRED' }, { status: 400 })
  }

  const smsUrl = process.env.SMS_API_URL ?? 'http://localhost/api/sms/send'
  const upstream = await fetch(smsUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      phone,
      message: `Vstupenka pro ${entry.holder_name} je připravena k vyzvednutí na místě will-call.`,
    }),
  })

  if (!upstream.ok) {
    const upstreamBody = await upstream.json().catch(() => ({}))
    return NextResponse.json({ sent: false, ...upstreamBody }, { status: 502 })
  }

  const result = await upstream.json()

  await db.updateEntry(entryId, { sms_sent_at: new Date() })

  return NextResponse.json({ sent: true, ...result })
}
