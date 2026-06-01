/**
 * GET /api/buyer/tickets/[ticketId]/calendar
 *
 * Vrátí .ics file (RFC 5545) pro Apple Calendar / Google Calendar / Outlook.
 * Auth: x-user-id musí být owner ticketu.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';


function icsEscape(s: string): string {
  return s.replace(/[\\;,]/g, '\\$&').replace(/\n/g, '\\n');
}

function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export async function GET(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const r = await db().query<{
    id: string;
    event_title: string;
    event_date_start: string;
    event_date_end: string | null;
    venue_name: string | null;
    venue_address: string | null;
    ticket_type_name: string;
  }>(
    `SELECT t.id,
            e.title AS event_title,
            e.date_start AS event_date_start,
            e.date_end AS event_date_end,
            v.name AS venue_name,
            v.address AS venue_address,
            tt.name AS ticket_type_name
     FROM tickets.tickets t
     JOIN orders.orders o ON o.id = t.order_id
     JOIN catalog.events e ON e.id = o.event_id
     JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     WHERE t.id = $1 AND t.owner_id = $2 AND t.status = 'valid'`,
    [params.ticketId, userId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const t = r.rows[0];

  const dtStart = icsDate(t.event_date_start);
  const dtEnd = icsDate(
    t.event_date_end ?? new Date(new Date(t.event_date_start).getTime() + 3 * 60 * 60 * 1000).toISOString(),
  );
  const dtStamp = icsDate(new Date().toISOString());
  const summary = icsEscape(`${t.event_title} — ${t.ticket_type_name}`);
  const location = icsEscape(
    [t.venue_name, t.venue_address].filter(Boolean).join(', ') || '',
  );
  const description = icsEscape(`Ticket ID: ${t.id}\nTixly`);

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tixly//Ticket Calendar//CS',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:tixly-ticket-${t.id}@tixly.cz`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    location ? `LOCATION:${location}` : '',
    `DESCRIPTION:${description}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${summary} za 2 hodiny`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="tixly-${t.id.slice(0, 8)}.ics"`,
    },
  });

  });
}
