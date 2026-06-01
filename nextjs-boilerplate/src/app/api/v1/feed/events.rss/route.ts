/**
 * GET /api/v1/feed/events.rss
 *
 * RSS 2.0 feed pro fanoušky a 3rd party aggregátory (GoOut indexer apod.).
 * Query: ?promoterId, ?category, ?city
 */
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/rls-pool';


function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const promoterId = url.searchParams.get('promoterId');
  const category = url.searchParams.get('category');
  const city = url.searchParams.get('city');

  const conditions: string[] = [
    `e.status = 'published'`,
    `p.status = 'active'`,
    `e.date_start >= now()`,
  ];
  const args: unknown[] = [];
  if (promoterId) { args.push(promoterId); conditions.push(`e.promoter_id = $${args.length}`); }
  if (category) { args.push(category); conditions.push(`e.category = $${args.length}`); }
  if (city) { args.push(city); conditions.push(`LOWER(v.city) = LOWER($${args.length})`); }

  const r = await db().query<{
    id: string;
    title: string;
    description: string | null;
    date_start: string;
    venue_name: string | null;
    city: string | null;
    cover_image_url: string | null;
    promoter_name: string;
    created_at: string;
  }>(
    `SELECT e.id, e.title, e.description, e.date_start::text,
            v.name AS venue_name, v.city,
            e.cover_image_url, p.name AS promoter_name, e.created_at::text
       FROM catalog.events e
  LEFT JOIN catalog.venues v ON v.id = e.venue_id
       JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE ${conditions.join(' AND ')}
   ORDER BY e.date_start
      LIMIT 100`,
    args,
  );

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.tixly.cz';
  const feedTitle = `Tixly Events${category ? ` — ${category}` : ''}${city ? ` — ${city}` : ''}`;

  const items = r.rows.map((ev) => {
    const eventUrl = `${baseUrl}/cs/events/${ev.id}`;
    const eventDate = new Date(ev.date_start);
    return `
    <item>
      <title>${escapeXml(ev.title)}</title>
      <link>${escapeXml(eventUrl)}</link>
      <guid isPermaLink="true">${escapeXml(eventUrl)}</guid>
      <pubDate>${new Date(ev.created_at).toUTCString()}</pubDate>
      <category>${escapeXml(ev.promoter_name)}</category>
      <description><![CDATA[
        <p><strong>${ev.venue_name ? `${ev.venue_name}${ev.city ? `, ${ev.city}` : ''}` : ''}</strong></p>
        <p>${eventDate.toLocaleString('cs-CZ')}</p>
        <p>${ev.description ?? ''}</p>
      ]]></description>
      ${ev.cover_image_url ? `<enclosure url="${escapeXml(ev.cover_image_url)}" type="image/jpeg" length="0"/>` : ''}
    </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(feedTitle)}</title>
    <link>${escapeXml(baseUrl)}/cs/events</link>
    <description>Aktuální akce na Tixly</description>
    <language>cs-CZ</language>
    <atom:link href="${escapeXml(`${baseUrl}/api/v1/feed/events.rss`)}" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });
}
