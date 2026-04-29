import { NextRequest, NextResponse } from 'next/server'
import { SeoService } from '@/services/seo.service'
import type { SeoDbAdapter } from '@/services/seo.service'

// ---------------------------------------------------------------------------
// Replace with real DB adapter wired to your database.
// ---------------------------------------------------------------------------
const db: SeoDbAdapter = {
  getEventForSeo: async (_id) => null,
  getTicketTypesForSeo: async (_id) => [],
  getAllActiveEvents: async () => [],
}

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://tixly.cz'
const seoService = new SeoService()

/**
 * GET /api/sitemap.xml
 * Returns a complete XML sitemap of all active events.
 *
 * Cached for 1 hour (3600s) — sitemap changes are not time-critical.
 */
export async function GET(
  _req: NextRequest,
): Promise<NextResponse> {
  try {
    const xml = await seoService.generateSitemap(BASE_URL, db)

    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error) {
    console.error('[GET /api/sitemap.xml]', error)
    return NextResponse.json(
      { error: 'Failed to generate sitemap' },
      { status: 500 },
    )
  }
}
