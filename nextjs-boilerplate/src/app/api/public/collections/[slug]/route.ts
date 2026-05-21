/**
 * GET /api/public/collections/[slug]
 *
 * Public collection view — vrátí všechny eventy v collectiona (manual + auto_filter match).
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const c = await db().query<{
    id: string;
    title: string;
    subtitle: string | null;
    description: string | null;
    cover_image_url: string | null;
    display_style: string;
    auto_filter: { category?: string; city?: string; promoter_id?: string } | null;
  }>(
    `SELECT id, title, subtitle, description, cover_image_url, display_style, auto_filter
       FROM catalog.event_collections
      WHERE slug = $1 AND is_public = true
      LIMIT 1`,
    [params.slug],
  );

  if (c.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const collection = c.rows[0];

  // Manual events
  const manualEvents = await db().query(
    `SELECT e.id, e.title, e.slug, e.date_start::text AS date_start,
            e.cover_image_url, e.category,
            v.name AS venue_name, v.city,
            p.name AS promoter_name
       FROM catalog.collection_events ce
       JOIN catalog.events e ON e.id = ce.event_id
  LEFT JOIN catalog.venues v ON v.id = e.venue_id
       JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE ce.collection_id = $1
        AND e.status = 'published'
        AND p.status = 'active'
        AND e.date_start >= now()
   ORDER BY ce.display_order, e.date_start`,
    [collection.id],
  );

  // Auto-filter events (pokud collection má auto_filter)
  let autoEvents: typeof manualEvents.rows = [];
  if (collection.auto_filter) {
    const filter = collection.auto_filter;
    const conditions: string[] = [
      `e.status = 'published'`,
      `p.status = 'active'`,
      `e.date_start >= now()`,
    ];
    const args: unknown[] = [];
    if (filter.category) {
      args.push(filter.category);
      conditions.push(`e.category = $${args.length}`);
    }
    if (filter.city) {
      args.push(filter.city);
      conditions.push(`LOWER(v.city) = LOWER($${args.length})`);
    }
    if (filter.promoter_id) {
      args.push(filter.promoter_id);
      conditions.push(`e.promoter_id = $${args.length}`);
    }
    const auto = await db().query(
      `SELECT e.id, e.title, e.slug, e.date_start::text,
              e.cover_image_url, e.category,
              v.name AS venue_name, v.city,
              p.name AS promoter_name
         FROM catalog.events e
    LEFT JOIN catalog.venues v ON v.id = e.venue_id
         JOIN platform.promoters p ON p.id = e.promoter_id
        WHERE ${conditions.join(' AND ')}
     ORDER BY e.date_start
        LIMIT 50`,
      args,
    );
    autoEvents = auto.rows;
  }

  // Merge a deduplikuj (manual má prioritu pořadí)
  const seen = new Set(manualEvents.rows.map((e) => e.id));
  const allEvents = [
    ...manualEvents.rows,
    ...autoEvents.filter((e) => !seen.has(e.id)),
  ];

  return NextResponse.json({
    collection,
    events: allEvents,
    count: allEvents.length,
  });
}
