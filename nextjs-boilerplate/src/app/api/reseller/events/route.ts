import { NextRequest, NextResponse } from 'next/server'
import { requireReseller } from '@/lib/reseller-auth'
import { db, runWithServiceContext } from '@/lib/db/rls-pool'

export const dynamic = 'force-dynamic'

interface EventRow {
  id: string
  title: string
  date_start: string
  venue: string
  ticket_type_id: string
  ticket_type_name: string
  price_halire: number
  remaining_qty: number
  promoter_name: string
}

export async function GET(req: NextRequest): Promise<Response> {
  let session
  try {
    session = await requireReseller(req)
  } catch (e) {
    return e as Response
  }
  void session

  const url = new URL(req.url)
  const q = url.searchParams.get('q') || null
  const date = url.searchParams.get('date') || null

  return runWithServiceContext(async () => {
    const r = await db().query<EventRow>(
      `SELECT e.id, e.title, e.date_start, v.name AS venue,
              tt.id AS ticket_type_id, tt.name AS ticket_type_name,
              tt.base_price AS price_halire, tt.remaining_qty,
              p.name AS promoter_name
       FROM catalog.events e
       JOIN catalog.venues v ON v.id = e.venue_id
       JOIN catalog.ticket_types tt ON tt.event_id = e.id AND tt.is_active = true AND tt.remaining_qty > 0
       JOIN platform.promoters p ON p.id = e.promoter_id
       WHERE e.status = 'published' AND e.date_start > NOW()
         AND ($1::text IS NULL OR e.title ILIKE '%' || $1 || '%')
         AND ($2::date IS NULL OR e.date_start::date = $2::date)
       ORDER BY e.date_start
       LIMIT 50`,
      [q, date],
    )

    return NextResponse.json({ events: r.rows })
  })
}
