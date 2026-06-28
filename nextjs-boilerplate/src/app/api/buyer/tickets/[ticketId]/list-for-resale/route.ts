/**
 * POST /api/buyer/tickets/[ticketId]/list-for-resale
 * DELETE /api/buyer/tickets/[ticketId]/list-for-resale (cancel listing)
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
    const b = await req.json() as {
      listing_price_halire: number;
      seller_notes?: string;
    };

    if (!b.listing_price_halire || b.listing_price_halire <= 0) {
      return NextResponse.json({ error: 'Invalid listing price' }, { status: 400 });
    }

    return runWithServiceContext(async () => {
      const ticketR = await db().query(
        `SELECT
           t.id,
           t.status,
           t.ticket_type_id,
           t.order_id,
           t.seat_id,
           o.buyer_user_id,
           o.paid_at,
           o.event_id,
           tt.name  AS ticket_type_name,
           tt.price AS original_price_halire,
           e.resale_enabled,
           e.resale_max_price_pct,
           e.resale_platform_fee_pct,
           e.resale_cooling_hours,
           e.resale_allow_below_face,
           e.start_date,
           s.label  AS seat_label,
           s.section_label
         FROM orders.tickets t
         JOIN orders.orders       o  ON o.id = t.order_id
         JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
         JOIN catalog.events       e  ON e.id = o.event_id
         LEFT JOIN catalog.event_seats s ON s.id = t.seat_id
         WHERE t.id = $1`,
        [params.ticketId],
      );

      if (ticketR.rows.length === 0) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      }

      const ticket = ticketR.rows[0] as {
        id: string;
        status: string;
        buyer_user_id: string;
        paid_at: string | null;
        event_id: string;
        ticket_type_name: string;
        original_price_halire: number;
        resale_enabled: boolean;
        resale_max_price_pct: number;
        resale_platform_fee_pct: number;
        resale_cooling_hours: number;
        resale_allow_below_face: boolean;
        start_date: string;
        seat_label: string | null;
        section_label: string | null;
      };

      if (ticket.buyer_user_id !== userId) {
        return NextResponse.json({ error: 'Not your ticket' }, { status: 403 });
      }

      if (ticket.status !== 'issued') {
        return NextResponse.json({ error: `Cannot list ticket with status '${ticket.status}'` }, { status: 409 });
      }

      if (!ticket.resale_enabled) {
        return NextResponse.json({ error: 'Resale is not enabled for this event' }, { status: 403 });
      }

      if (new Date(ticket.start_date) < new Date()) {
        return NextResponse.json({ error: 'Cannot list ticket for a past event' }, { status: 409 });
      }

      const maxPrice = Math.round(ticket.original_price_halire * ticket.resale_max_price_pct / 100);
      if (b.listing_price_halire > maxPrice) {
        return NextResponse.json({
          error: `Listing price exceeds cap of ${(maxPrice / 100).toFixed(0)} Kč`,
          max_price_halire: maxPrice,
        }, { status: 422 });
      }

      if (!ticket.resale_allow_below_face && b.listing_price_halire < ticket.original_price_halire) {
        return NextResponse.json({ error: 'Listing below face value is not allowed for this event' }, { status: 422 });
      }

      if (ticket.paid_at && ticket.resale_cooling_hours > 0) {
        const coolEnd = new Date(ticket.paid_at);
        coolEnd.setHours(coolEnd.getHours() + ticket.resale_cooling_hours);
        if (new Date() < coolEnd) {
          return NextResponse.json({
            error: `Ticket can be listed after ${coolEnd.toISOString()}`,
            available_at: coolEnd.toISOString(),
          }, { status: 409 });
        }
      }

      const existR = await db().query(
        `SELECT id FROM orders.resale_listings
         WHERE ticket_id=$1 AND status IN ('available','reserved') LIMIT 1`,
        [params.ticketId],
      );
      if (existR.rows.length > 0) {
        return NextResponse.json({ error: 'Ticket is already listed for resale' }, { status: 409 });
      }

      const platformFeeHalire = Math.round(b.listing_price_halire * ticket.resale_platform_fee_pct / 100);
      const sellerPayoutHalire = b.listing_price_halire - platformFeeHalire;

      const r = await db().query(
        `INSERT INTO orders.resale_listings
           (ticket_id, seller_user_id, event_id,
            ticket_type_name, seat_label, section_label,
            original_price_halire, listing_price_halire,
            platform_fee_halire, seller_payout_halire,
            seller_notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          params.ticketId, userId, ticket.event_id,
          ticket.ticket_type_name, ticket.seat_label ?? null, ticket.section_label ?? null,
          ticket.original_price_halire, b.listing_price_halire,
          platformFeeHalire, sellerPayoutHalire, b.seller_notes ?? null,
        ],
      );

      await db().query(
        `UPDATE orders.tickets SET status='listed', updated_at=NOW() WHERE id=$1`,
        [params.ticketId],
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
        `UPDATE orders.resale_listings
         SET status='cancelled', cancelled_at=NOW(), updated_at=NOW()
         WHERE ticket_id=$1 AND seller_user_id=$2 AND status='available'
         RETURNING id, ticket_id`,
        [params.ticketId, userId],
      );

      if (r.rows.length === 0) {
        return NextResponse.json({ error: 'Listing not found or already sold' }, { status: 404 });
      }

      await db().query(
        `UPDATE orders.tickets SET status='issued', updated_at=NOW() WHERE id=$1`,
        [r.rows[0].ticket_id as string],
      );

      return NextResponse.json({ ok: true });
    });
  });
}
