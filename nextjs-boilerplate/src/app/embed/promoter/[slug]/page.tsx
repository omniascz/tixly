import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { pgPoolOptions } from '@/lib/db/pg-options';
import { PromoterEmbedClient } from './PromoterEmbedClient';

interface PromoterRow {
  id: string;
  slug: string;
  name: string;
  brand_color_hex: string | null;
  brand_logo_url: string | null;
}

interface EventRow {
  id: string;
  title: string;
  slug: string | null;
  date_start: string;
  city: string | null;
  venue_name: string | null;
  cover_image: string | null;
  min_price_halire: number | null;
  currency: string | null;
}

async function fetchPromoterAndEvents(
  slug: string,
  limit: number,
): Promise<{ promoter: PromoterRow; events: EventRow[] } | null> {
  if (!/^[a-z0-9-]{2,80}$/.test(slug)) return null;
  const db = new Pool(pgPoolOptions(process.env.DATABASE_URL));
  try {
    const p = await db.query<PromoterRow>(
      `SELECT id, slug, name, brand_color_hex, brand_logo_url
         FROM platform.promoters
        WHERE slug = $1 AND status = 'active'
        LIMIT 1`,
      [slug],
    );
    if (p.rows.length === 0) return null;
    const promoter = p.rows[0];

    const e = await db.query<EventRow>(
      `SELECT e.id, e.title, e.slug, e.date_start::text, e.cover_image_url AS cover_image,
              v.city, v.name AS venue_name,
              (SELECT MIN(base_price) FROM catalog.ticket_types tt WHERE tt.event_id = e.id AND tt.visibility = 'public') AS min_price_halire,
              (SELECT currency FROM catalog.ticket_types tt WHERE tt.event_id = e.id LIMIT 1) AS currency
         FROM catalog.events e
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
        WHERE e.promoter_id = $1
          AND e.status = 'published'
          AND e.date_start > NOW()
        ORDER BY e.date_start ASC
        LIMIT $2`,
      [promoter.id, limit],
    );
    return { promoter, events: e.rows };
  } catch {
    return null;
  } finally {
    await db.end();
  }
}

export default async function EmbedPromoterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ theme?: string; limit?: string }>;
}) {
  const { slug } = await params;
  const { theme = 'light', limit = '12' } = await searchParams;
  const parsedLimit = Math.min(Math.max(Number(limit) || 12, 1), 50);

  const data = await fetchPromoterAndEvents(slug, parsedLimit);
  if (!data) notFound();

  return (
    <html lang="cs" data-theme={theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{`${data.promoter.name} — vstupenky`}</title>
        <style>{`
          html, body { margin: 0; padding: 0; background: transparent; font-family: system-ui, -apple-system, sans-serif; }
          * { box-sizing: border-box; }
        `}</style>
      </head>
      <body>
        <PromoterEmbedClient promoter={data.promoter} events={data.events} />
      </body>
    </html>
  );
}
