/**
 * GET /api/og/events/[id]
 *
 * Vrací 1200×630 PNG OG image (hash-based gradient + event title).
 * Cache 1h pro fast Open Graph crawler responses.
 */

import { ImageResponse } from 'next/og';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export const runtime = 'nodejs';
export const revalidate = 3600;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return new Response('Invalid id', { status: 422 });
  }

  const r = await db().query<{
    title: string;
    date_start: string;
    venue_name: string | null;
  }>(
    `SELECT e.title, e.date_start, v.name AS venue_name
     FROM catalog.events e
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     WHERE e.id = $1 AND e.status = 'published'`,
    [params.id],
  );
  if (r.rows.length === 0) {
    return new Response('Not found', { status: 404 });
  }
  const ev = r.rows[0]!;

  // Hash hue z eventId pro deterministický gradient
  const hue =
    [...params.id].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
  const dateStr = new Date(ev.date_start).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '60px',
          background: `linear-gradient(135deg, hsl(${hue}, 70%, 45%) 0%, hsl(${(hue + 60) % 360}, 75%, 35%) 100%)`,
          color: '#fff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 32, fontWeight: 700, opacity: 0.9 }}>Tixly</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              fontSize: ev.title.length > 40 ? 56 : 72,
              fontWeight: 800,
              lineHeight: 1.05,
              maxWidth: 1080,
            }}
          >
            {ev.title}
          </div>
          <div style={{ fontSize: 28, opacity: 0.95 }}>
            {dateStr}
            {ev.venue_name ? ` · ${ev.venue_name}` : ''}
          </div>
        </div>
        <div style={{ fontSize: 20, opacity: 0.8 }}>tixly.cz</div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
