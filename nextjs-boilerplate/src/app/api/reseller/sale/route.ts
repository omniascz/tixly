import { NextRequest, NextResponse } from 'next/server'
import { requireReseller } from '@/lib/reseller-auth'
import { db, runWithServiceContext } from '@/lib/db/rls-pool'
import { saleBlockedResponse } from '@/lib/sales/cutoff'
import { issueTicketsForOrder } from '@/lib/tickets/demo-issuer'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

interface TicketTypeRow {
  id: string
  base_price: number
  remaining_qty: number
  name: string
  event_id: string
}

interface UserRow {
  id: string
}

interface IssuedTicketRow {
  id: string
  totp_secret_encrypted: Buffer
  event_seat_id: string | null
  seat_label: string | null
}

export async function POST(req: NextRequest): Promise<Response> {
  let session
  try {
    session = await requireReseller(req)
  } catch (e) {
    return e as Response
  }

  let body: { eventId?: string; ticketTypeId?: string; buyerName?: string; buyerEmail?: string; quantity?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { eventId, ticketTypeId, buyerName, buyerEmail, quantity = 1 } = body
  if (!eventId || !ticketTypeId || !buyerName || !buyerEmail) {
    return NextResponse.json({ error: 'eventId, ticketTypeId, buyerName, buyerEmail required' }, { status: 400 })
  }
  if (quantity < 1 || quantity > 10) {
    return NextResponse.json({ error: 'quantity must be 1–10' }, { status: 400 })
  }
  // Kolo 7 (C-29): prodejce (pokladna třetí strany) prodává do konce akce, jako pokladna pořadatele.
  const salesClosed = await saleBlockedResponse(db(), eventId, 'box_office')
  if (salesClosed) return salesClosed

  return runWithServiceContext(async () => {
  const client = await db().connect()
  try {
    await client.query('BEGIN')

    const ttRes = await client.query<TicketTypeRow>(
      `SELECT id, base_price, remaining_qty, name, event_id
       FROM catalog.ticket_types
       WHERE id = $1 AND event_id = $2
       FOR UPDATE`,
      [ticketTypeId, eventId],
    )
    if (!ttRes.rows[0]) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Ticket type not found' }, { status: 404 })
    }
    const tt = ttRes.rows[0]
    if (tt.remaining_qty < quantity) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Not enough tickets available' }, { status: 409 })
    }

    let userRes = await client.query<UserRow>(
      `SELECT id FROM identity.users WHERE email = $1 AND anonymized_at IS NULL LIMIT 1`,
      [buyerEmail],
    )
    let userId: string
    if (userRes.rows[0]) {
      userId = userRes.rows[0].id
    } else {
      userId = randomUUID()
      // identity.users: guest se sentinel password_hash (nemůže se přihlásit),
      // gdpr_consent_at je NOT NULL bez defaultu. ON CONFLICT musí odpovídat
      // PARTIAL unique indexu uq_identity_users_email_active (WHERE anonymized_at IS NULL),
      // jinak 42P10 — stejný vzor jako checkout/season-passes.
      const ins = await client.query<UserRow>(
        `INSERT INTO identity.users (id, email, name, is_platform_admin, password_hash, gdpr_consent_at)
         VALUES ($1, $2, $3, false, '!guest', NOW())
         ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [userId, buyerEmail, buyerName],
      )
      userId = ins.rows[0].id
    }

    const totalAmount = tt.base_price * quantity
    const orderId = randomUUID()

    await client.query(
      `INSERT INTO orders.orders
         (id, user_id, event_id, status, payment_provider, total_amount, paid_at, expires_at)
       VALUES ($1, $2, $3, 'paid', 'reseller_cash', $4, NOW(), NOW() + INTERVAL '1 year')`,
      [orderId, userId, eventId, totalAmount],
    )

    await client.query(
      `INSERT INTO orders.order_items
         (id, order_id, ticket_type_id, quantity, unit_price, total_price)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
      [orderId, ticketTypeId, quantity, tt.base_price, tt.base_price * quantity],
    )

    await client.query(
      `UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - $1 WHERE id = $2`,
      [quantity, ticketTypeId],
    )

    const issued = await issueTicketsForOrder(orderId, client)

    const commissionAmount = Math.round(totalAmount * (session.commissionPct / 100))

    await client.query(
      `INSERT INTO orders.reseller_sales
         (partner_id, order_id, commission_pct, commission_amount_halire)
       VALUES ($1, $2, $3, $4)`,
      [session.partnerId, orderId, session.commissionPct, commissionAmount],
    )

    await client.query('COMMIT')

    const ticketsRes = await db().query<IssuedTicketRow>(
      `SELECT t.id, t.totp_secret_encrypted, t.event_seat_id,
              es.sector || ' ' || es.row || es.seat_number AS seat_label
       FROM tickets.tickets t
       LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
       WHERE t.order_id = $1`,
      [orderId],
    )

    const tickets = issued.map((iss, i) => ({
      id: iss.ticketId,
      qrPayload: `TXP:${iss.ticketId}`,
      seatLabel: ticketsRes.rows[i]?.seat_label ?? null,
    }))

    return NextResponse.json({
      orderId,
      tickets,
      commissionEarned: commissionAmount,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Reseller sale error:', err)
    return NextResponse.json({ error: 'Sale failed' }, { status: 500 })
  } finally {
    client.release()
  }
  }) // end runWithServiceContext
}
