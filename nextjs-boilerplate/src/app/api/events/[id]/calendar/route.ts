/**
 * GET /api/events/[id]/calendar
 *
 * Public .ics (RFC 5545) — pro RSVP "I'm interested" si může uživatel
 * uložit akci do kalendáře bez nákupu vstupenky. Apple Calendar /
 * Google Calendar / Outlook kompatibilní.
 *
 * Žádná auth — jen public akce (status='published').
 *
 * Rozdíl od /api/buyer/tickets/[ticketId]/calendar:
 *   - tenhle endpoint je o akci samotné (žádný ticket UID)
 *   - reminder TRIGGER -PT1D (den předem, ne 2h) — uživatel ještě nemá lístek
 *   - obsahuje URL na event detail page pro re-engagement
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function icsEscape(s: string): string {
  return s.replace(/[\\;,]/g, '\\$&').replace(/\n/g, '\\n');
}

function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  }

  const r = await db().query<{
    id: string;
    title: string;
    slug: string | null;
    description: string | null;
    date_start: string;
    date_end: string | null;
    venue_name: string | null;
    venue_address: string | null;
    city: string | null;
    promoter_name: string;
  }>(
    `SELECT e.id, e.title, e.slug, e.description,
            e.date_start, e.date_end,
            v.name AS venue_name, v.address AS venue_address, v.city,
            p.name AS promoter_name
       FROM catalog.events e
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       LEFT JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE e.id = $1 AND e.status = 'published'`,
    [id],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const ev = r.rows[0];

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.tixly.cz';
  const eventUrl = `${baseUrl}/cs/events/${ev.slug ?? ev.id}`;

  const dtStart = icsDate(ev.date_start);
  const dtEnd = icsDate(
    ev.date_end ??
      new Date(new Date(ev.date_start).getTime() + 3 * 60 * 60 * 1000).toISOString(),
  );
  const dtStamp = icsDate(new Date().toISOString());
  const summary = icsEscape(ev.title);
  const location = icsEscape(
    [ev.venue_name, ev.venue_address, ev.city].filter(Boolean).join(', ') || '',
  );
  const descPlain = ev.description
    ? ev.description.replace(/<[^>]+>/g, '').slice(0, 1000)
    : '';
  const description = icsEscape(
    [descPlain, `Pořadatel: ${ev.promoter_name}`, eventUrl].filter(Boolean).join('\n\n'),
  );

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tixly//Event Calendar//CS',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:tixly-event-${ev.id}@tixly.cz`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    location ? `LOCATION:${location}` : '',
    `DESCRIPTION:${description}`,
    `URL:${eventUrl}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:${summary} zítra`,
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
      'Content-Disposition': `attachment; filename="tixly-event-${(ev.slug ?? ev.id).slice(0, 30)}.ics"`,
      'Cache-Control': 'public, s-maxage=3600',
    },
  });
}
