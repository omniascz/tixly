/**
 * POST /api/buyer/tickets/[ticketId]/list-for-resale
 * DELETE /api/buyer/tickets/[ticketId]/list-for-resale (cancel listing)
 *
 * Uses prod schema:
 *  - tickets.tickets (owner_id, status='valid')
 *  - resale.resale_listings (seller_id, ask_price, original_price, status='active')
 *  - catalog.events.resale_* settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const b = await req.json() as { ask_price: number; seller_notes?: string };
    if (!b.ask_price || b.ask_price <= 0) {
      return NextResponse.json({ error: 'Invalid listing price' }, { status: 400 });
    }

    return runWithServiceContext(async () => {
      // Load ticket + eligibility + event settings
      const ticketR = await db().query(
        `SELECT
           t.id, t.status, t.owner_id, t.original_price, t.order_id,
           o.paid_at, o.event_id,
           tt.name                      AS ticket_type_name,
           tt.price                     AS face_price,
           e.resale_enabled,
           e.resale_max_price_pct,
           e.resale_platform_fee_pct,
           e.resale_cooling_hours,
           e.resale_allow_below_face,
           e.date_start,
           es.label                     AS seat_label
         FROM tickets.tickets t
         JOIN orders.orders       o  ON o.id  = t.order_id
         JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
         JOIN catalog.events       e  ON e.id  = o.event_id
         LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
         WHERE t.id = $1`,
        [params.ticketId],
      );

      if (ticketR.rows.length === 0) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      }

      const ticket = ticketR.rows[0] as {
        id: string; status: string; owner_id: string;
        original_price: number; order_id: string; paid_at: string | null; event_id: string;
        ticket_type_name: string; face_price: number;
        resale_enabled: boolean; resale_max_price_pct: number;
        resale_platform_fee_pct: number; resale_cooling_hours: number;
        resale_allow_below_face: boolean; date_start: string;
        seat_label: string | null;
      };

      if (ticket.owner_id !== userId) return NextResponse.json({ error: 'Not your ticket' }, { status: 403 });
      if (ticket.status !== 'valid') return NextResponse.json({ error: `Ticket status is '${ticket.status}'` }, { status: 409 });
      if (!ticket.resale_enabled) return NextResponse.json({ error: 'Resale not enabled for this event' }, { status: 403 });
      if (new Date(ticket.date_start) < new Date()) return NextResponse.json({ error: 'Event already started' }, { status: 409 });

      const facePrice = ticket.face_price ?? ticket.original_price ?? 0;
      const maxPrice = Math.round(facePrice * ticket.resale_max_price_pct / 100);
      if (b.ask_price > maxPrice) {
        return NextResponse.json({
          error: `Price exceeds cap of ${(maxPrice / 100).toFixed(0)} Kč`,
          max_price: maxPrice,
        }, { status: 422 });
      }
      if (!ticket.resale_allow_below_face && b.ask_price < facePrice) {
        return NextResponse.json({ error: 'Listing below face value is not allowed' }, { status: 422 });
      }

      // Cooling period
      if (ticket.paid_at && ticket.resale_cooling_hours > 0) {
        const coolEnd = new Date(ticket.paid_at);
        coolEnd.setHours(coolEnd.getHours() + ticket.resale_cooling_hours);
        if (new Date() < coolEnd) {
          return NextResponse.json({ error: 'Cooling period active', available_at: coolEnd.toISOString() }, { status: 409 });
        }
      }

      // Check no active listing
      const existR = await db().query(
        `SELECT id FROM resale.resale_listings
         WHERE ticket_id=$1 AND status IN ('active','reserved') LIMIT 1`,
        [params.ticketId],
      );
      if (existR.rows.length > 0) {
        return NextResponse.json({ error: 'Ticket already listed' }, { status: 409 });
      }

      const platformFee = Math.round(b.ask_price * ticket.resale_platform_fee_pct / 100);
      const sellerPayout = b.ask_price - platformFee;

      const r = await db().query(
        `INSERT INTO resale.resale_listings
           (ticket_id, seller_id, ask_price, original_price,
            original_purchase_price_halire, face_value_cap_halire,
            commission_rate, platform_fee_halire, seller_payout_halire,
            ticket_type_name, seat_label, seller_notes,
            status, mode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active','standard')
         RETURNING id, listed_at`,
        [
          params.ticketId, userId, b.ask_price, facePrice,
          facePrice, maxPrice,
          Math.round(ticket.resale_platform_fee_pct), platformFee, sellerPayout,
          ticket.ticket_type_name, ticket.seat_label ?? null, b.seller_notes ?? null,
        ],
      );

      return NextResponse.json({ listing: r.rows[0] }, { status: 201 });
    });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
    return runWithServiceContext(async () => {
      const r = await db().query(
        `UPDATE resale.resale_listings
         SET status='cancelled', cancelled_at=NOW()
         WHERE ticket_id=$1 AND seller_id=$2 AND status='active'
         RETURNING id`,
        [params.ticketId, userId],
      );

      if (r.rows.length === 0) {
        return NextResponse.json({ error: 'Listing not found or already sold' }, { status: 404 });
      }

      return NextResponse.json({ ok: true });
    });
  });
}
