import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

interface MemoryRow {
  id: string;
  status: string;
  used_at: string | null;
  commemorative_sent_at: string | null;
  event_id: string;
  event_title: string;
  event_date_start: string | null;
  venue_name: string | null;
  quote: string | null;
  theme_color: string | null;
  accent_color: string | null;
  custom_message: string | null;
  ticket_type_name: string;
  seat_label: string | null;
  owner_id: string;
}

interface CastRow {
  role_name: string;
  actor_name: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: ticketId } = await params;

  const queryToken = req.nextUrl.searchParams.get('token');
  const userId = req.headers.get('x-user-id');

  return runWithServiceContext(async () => {
    const r = await db().query<MemoryRow>(
      `SELECT t.id, t.status, t.used_at, t.commemorative_sent_at, t.owner_id,
              e.id AS event_id, e.title AS event_title, e.date_start AS event_date_start,
              v.name AS venue_name,
              ct.quote, ct.theme_color, ct.accent_color, ct.custom_message,
              tt.name AS ticket_type_name,
              CASE WHEN es.id IS NOT NULL
                   THEN concat_ws(' ', es.sector, es.row_label, es.seat_number::text)
                   ELSE NULL END AS seat_label
         FROM tickets.tickets t
         JOIN orders.orders o ON o.id = t.order_id
         JOIN catalog.events e ON e.id = o.event_id
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         LEFT JOIN catalog.commemorative_templates ct ON ct.event_id = e.id
         JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
         LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
        WHERE t.id = $1`,
      [ticketId],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const ticket = r.rows[0];

    const isOwner = userId && userId === ticket.owner_id;
    const hasQueryToken = !!queryToken;

    if (!isOwner && !hasQueryToken) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const castRes = await db().query<CastRow>(
      `SELECT pc.role_name, pc.artist_name AS actor_name
         FROM lineups.performance_cast pc
        WHERE pc.event_id = $1 AND pc.is_visible = true
        ORDER BY pc.order_index ASC, pc.created_at ASC
        LIMIT 8`,
      [ticket.event_id],
    );

    return NextResponse.json({
      ticket: {
        id: ticket.id,
        status: ticket.status,
        usedAt: ticket.used_at,
        commemorativeSentAt: ticket.commemorative_sent_at,
        ticketTypeName: ticket.ticket_type_name,
        seatLabel: ticket.seat_label,
      },
      event: {
        id: ticket.event_id,
        title: ticket.event_title,
        dateStart: ticket.event_date_start,
      },
      venue: ticket.venue_name ? { name: ticket.venue_name } : null,
      cast: castRes.rows,
      template: ticket.theme_color
        ? {
            quote: ticket.quote,
            themeColor: ticket.theme_color,
            accentColor: ticket.accent_color,
            customMessage: ticket.custom_message,
          }
        : null,
    });
  });
}
