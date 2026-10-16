/**
 * GET /api/buyer/orders/[orderId]/calendar.ics
 *
 * Vrátí RFC 5545 iCalendar soubor pro event z dané objednávky.
 * Přístup: buyer (x-user-id header) NEBO guest přes orderId-as-capability.
 * Bez autentizace vracíme 401. OrderId je UUID → dostatečně náhodné jako capability.
 */

import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EventRow {
  event_title: string | null;
  event_description: string | null;
  date_start: string | Date | null;
  date_end: string | Date | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_city: string | null;
  event_id: string | null;
  order_status: string;
  buyer_user_id: string;
}

function formatIcsDate(value: string | Date): string {
  // `pg` vrací timestamptz jako Date — dřív `iso.replace` na Date shodilo každé volání (500).
  // Vždy přes Date → UTC: "2026-09-15T19:00:00.000Z" → "20260915T190000Z".
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function foldLine(line: string): string {
  // RFC 5545 §3.1: fold lines longer than 75 octets
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const chunks: string[] = [];
  let offset = 0;
  let first = true;
  while (offset < bytes.length) {
    const max = first ? 75 : 74;
    chunks.push((first ? '' : ' ') + bytes.subarray(offset, offset + max).toString('utf8'));
    offset += max;
    first = false;
  }
  return chunks.join('\r\n');
}

export async function GET(req: NextRequest, props: { params: Promise<{ orderId: string }> }): Promise<Response> {
  const params = await props.params;
  // Neplatné UUID dřív šlo rovnou do SQL (22P02 → 500).
  if (!UUID_RE.test(params.orderId)) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return runWithServiceContext(async () => {
    const userId = req.headers.get('x-user-id');

    const res = await db().query<EventRow>(
      `SELECT e.title AS event_title, e.description AS event_description,
              e.date_start, e.date_end,
              v.name AS venue_name, v.address AS venue_address, v.city AS venue_city,
              o.event_id, o.status AS order_status, o.user_id AS buyer_user_id
         FROM orders.orders o
         LEFT JOIN catalog.events e ON e.id = o.event_id
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
        WHERE o.id = $1`,
      [params.orderId],
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const row = res.rows[0];

    // Auth: buyer must match OR orderId is used as capability (guest checkout)
    if (userId && userId !== row.buyer_user_id) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    if (!row.date_start || !row.event_title) {
      return NextResponse.json({ error: 'NO_EVENT' }, { status: 422 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.tixly.cz';
    // UID musí být stabilní pro objednávku (aktualizace v kalendáři), ale ID objednávky
    // do těla nevracíme — odvozený otisk místo něj.
    const uid = `order-${createHash('sha256').update(params.orderId).digest('hex').slice(0, 32)}@tixly.cz`;
    const dtStamp = formatIcsDate(new Date().toISOString());
    const dtStart = formatIcsDate(row.date_start);
    const dtEnd = row.date_end ? formatIcsDate(row.date_end) : dtStart;

    const locationParts = [row.venue_name, row.venue_address, row.venue_city].filter(Boolean);
    const location = locationParts.join(', ');

    const summary = escapeIcs(row.event_title);
    const desc = row.event_description ? escapeIcs(row.event_description) : '';
    const url = `${appUrl}/cs/my-tickets`;

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Tixly//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      foldLine(`UID:${uid}`),
      foldLine(`DTSTAMP:${dtStamp}`),
      foldLine(`DTSTART:${dtStart}`),
      foldLine(`DTEND:${dtEnd}`),
      foldLine(`SUMMARY:${summary}`),
      ...(location ? [foldLine(`LOCATION:${escapeIcs(location)}`)] : []),
      ...(desc ? [foldLine(`DESCRIPTION:${desc}`)] : []),
      foldLine(`URL:${url}`),
      'END:VEVENT',
      'END:VCALENDAR',
    ];

    const icsContent = lines.join('\r\n') + '\r\n';
    const safeTitle = row.event_title.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40);

    return new Response(icsContent, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeTitle}.ics"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
