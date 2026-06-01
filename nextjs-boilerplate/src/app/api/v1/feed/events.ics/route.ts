/**
 * GET /api/v1/feed/events.ics
 *
 * iCalendar feed pro fanoušky a 3rd party kalendáře.
 * Query:
 *   ?promoterId=<uuid> (volitelný filter)
 *   ?category=<text>
 *   ?city=<text>
 *
 * Klient subscribuje URL ve svém Google Calendar / Outlook / Apple Calendar.
 */
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/rls-pool';


export const dynamic = 'force-dynamic';
export const revalidate = 3600; // 1 h browser/CDN cache

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function fmtIcsDate(iso: string): string {
  // 2026-05-21T18:30:00Z → 20260521T183000Z
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const promoterId = url.searchParams.get('promoterId');
  const category = url.searchParams.get('category');
  const city = url.searchParams.get('city');

  const conditions: string[] = [
    `e.status = 'published'`,
    `p.status = 'active'`,
    `e.date_start >= now() - INTERVAL '7 days'`,
    `e.date_start <= now() + INTERVAL '365 days'`,
  ];
  const args: unknown[] = [];
  if (promoterId) {
    args.push(promoterId);
    conditions.push(`e.promoter_id = $${args.length}`);
  }
  if (category) {
    args.push(category);
    conditions.push(`e.category = $${args.length}`);
  }
  if (city) {
    args.push(city);
    conditions.push(`LOWER(v.city) = LOWER($${args.length})`);
  }

  const r = await db().query<{
    id: string;
    title: string;
    description: string | null;
    date_start: string;
    date_end: string | null;
    venue_name: string | null;
    city: string | null;
    address: string | null;
    promoter_name: string;
    slug: string | null;
    promoter_slug: string;
  }>(
    `SELECT e.id, e.title, e.description, e.date_start::text, e.date_end::text,
            v.name AS venue_name, v.city, v.address,
            p.name AS promoter_name, e.slug, p.slug AS promoter_slug
       FROM catalog.events e
  LEFT JOIN catalog.venues v ON v.id = e.venue_id
       JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE ${conditions.join(' AND ')}
   ORDER BY e.date_start
      LIMIT 500`,
    args,
  );

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.tixly.cz';
  const now = fmtIcsDate(new Date().toISOString());

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tixly//Discovery Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:Tixly Events${category ? ` — ${category}` : ''}${city ? ` — ${city}` : ''}`,
    'X-WR-TIMEZONE:Europe/Prague',
  ];

  for (const ev of r.rows) {
    const endDate = ev.date_end ?? new Date(new Date(ev.date_start).getTime() + 3 * 60 * 60 * 1000).toISOString();
    const eventUrl = `${baseUrl}/cs/events/${ev.id}`;
    const location = [ev.venue_name, ev.address, ev.city].filter(Boolean).join(', ');

    lines.push(
      'BEGIN:VEVENT',
      `UID:event-${ev.id}@tixly.cz`,
      `DTSTAMP:${now}`,
      `DTSTART:${fmtIcsDate(ev.date_start)}`,
      `DTEND:${fmtIcsDate(endDate)}`,
      `SUMMARY:${icsEscape(ev.title)}`,
      `DESCRIPTION:${icsEscape(`${ev.promoter_name}\\n${ev.description ?? ''}\\n\\n${eventUrl}`)}`,
      `LOCATION:${icsEscape(location)}`,
      `URL:${eventUrl}`,
      `ORGANIZER;CN=${icsEscape(ev.promoter_name)}:mailto:noreply@tixly.cz`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');

  return new Response(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="tixly-events.ics"',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
