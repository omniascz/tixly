import { NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { errorResponse } from '../../../../../../lib/route-helpers.js';
import { getSitemapEntries } from '../../../../../../services/landing-page.service.js';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(
  request: Request,
  { params }: { params: { promoterId: string } },
) {
  try {
    const entries = await getSitemapEntries(params.promoterId, getServiceDeps());
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    const urls = entries
      .map((e) => {
        const slugPath = e.slug === '/' ? '' : `/${e.slug.replace(/^\/+/, '')}`;
        const loc = `${baseUrl}${slugPath}`;
        const lastmod = e.updatedAt.toISOString().split('T')[0];
        return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
      })
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;

    return new NextResponse(xml, {
      status: 200,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
