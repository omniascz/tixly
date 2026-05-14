import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { EmbedClient } from './EmbedClient';

interface EventRow {
  id: string;
  title: string;
  slug: string | null;
  date_start: string;
  city: string | null;
  venue_name: string | null;
  cover_image: string | null;
  promoter_name: string;
  brand_color_hex: string | null;
}

async function fetchEvent(eventId: string): Promise<EventRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null;
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await db.query<EventRow>(
      `SELECT e.id, e.title, e.slug, e.date_start::text, e.cover_image,
              v.city, v.name AS venue_name,
              p.name AS promoter_name, p.brand_color_hex
       FROM catalog.events e
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       LEFT JOIN platform.promoters p ON p.id = e.promoter_id
       WHERE e.id = $1 AND e.status = 'published'`,
      [eventId],
    );
    return r.rows[0] ?? null;
  } finally {
    await db.end();
  }
}

export default async function EmbedEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ theme?: string; variant?: string }>;
}) {
  const { id } = await params;
  const { theme = 'light', variant = 'card' } = await searchParams;
  const event = await fetchEvent(id);
  if (!event) notFound();

  return (
    <html lang="cs" data-theme={theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{event.title}</title>
        <style>{`
          html, body { margin: 0; padding: 0; background: transparent; font-family: system-ui, -apple-system, sans-serif; }
          * { box-sizing: border-box; }
        `}</style>
      </head>
      <body>
        <EmbedClient event={event} variant={variant} />
      </body>
    </html>
  );
}
