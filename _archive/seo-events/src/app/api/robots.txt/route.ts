import { NextRequest, NextResponse } from 'next/server'
import { SeoService } from '@/services/seo.service'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://tixly.cz'
const seoService = new SeoService()

/**
 * GET /api/robots.txt
 * Returns a robots.txt file as plain text.
 *
 * Cached for 1 day (86400s) — robots.txt rarely changes.
 */
export async function GET(
  _req: NextRequest,
): Promise<NextResponse> {
  try {
    const txt = seoService.generateRobotsTxt(BASE_URL)

    return new NextResponse(txt, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('[GET /api/robots.txt]', error)
    return NextResponse.json(
      { error: 'Failed to generate robots.txt' },
      { status: 500 },
    )
  }
}
