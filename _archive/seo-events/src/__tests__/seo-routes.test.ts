import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock next/server before importing routes
vi.mock('next/server', () => import('./__mocks__/next-server'))

import { GET as getEventSeo } from '@/app/api/events/[eventId]/seo/route'
import { GET as getSitemapXml } from '@/app/api/sitemap.xml/route'
import { GET as getRobotsTxt } from '@/app/api/robots.txt/route'
import { NextRequest } from './__mocks__/next-server'
import type { EventForSeo, TicketTypeForSeo, ActiveEventListItem } from '@/types/seo.types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(url: string): NextRequest {
  return new NextRequest(url)
}

const makeDate = (iso: string): Date => new Date(iso)

const sampleEvent: EventForSeo = {
  id: 'evt-1',
  name: 'Festival XY',
  description: 'Největší festival léta.',
  date: makeDate('2026-08-15T18:00:00Z'),
  endDate: null,
  status: 'active',
  timezone: 'Europe/Prague',
  currency: 'CZK',
  venue: {
    name: 'Letňany Park',
    address: 'Veselská 1',
    city: 'Praha',
    region: 'Hlavní město Praha',
    postalCode: '19800',
    country: 'CZ',
    lat: 50.1302,
    lng: 14.5078,
  },
  organizer: { name: 'Live Nation CZ', url: 'https://livenation.cz' },
  performers: [
    { name: 'Radiohead', type: 'band' },
  ],
  images: ['https://cdn.tixly.cz/festival-xy.jpg'],
}

const sampleTickets: TicketTypeForSeo[] = [
  {
    name: 'Standard',
    price: 49000,
    saleStart: makeDate('2026-01-01T00:00:00Z'),
    available: true,
    url: 'https://tixly.cz/akce/festival-xy-2026-praha/koupit',
  },
]

const sampleActiveEvents: ActiveEventListItem[] = [
  {
    id: 'evt-1',
    slug: 'festival-xy-2026-praha',
    updatedAt: makeDate('2026-04-01T00:00:00Z'),
    date: makeDate('2026-08-15T18:00:00Z'),
    ticketsSold: 100,
    capacity: 1000,
    status: 'active',
  },
  {
    id: 'evt-2',
    slug: 'rock-fest-2026-brno',
    updatedAt: makeDate('2026-03-15T00:00:00Z'),
    date: makeDate('2026-06-01T20:00:00Z'),
    ticketsSold: 500,
    capacity: 500,
    status: 'active',
  },
]

// ── Mock the DB adapter used inside route modules ────────────────────────────

// The route files create their own stub db adapter that returns nulls/empty.
// We mock the SeoService methods to control behavior without needing a real db.
vi.mock('@/services/seo.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/seo.service')>('@/services/seo.service')

  // Keep the real SeoService but allow spying
  return {
    ...actual,
    SeoService: actual.SeoService,
  }
})

// ── GET /api/events/[eventId]/seo ────────────────────────────────────────────

describe('GET /api/events/[eventId]/seo', () => {
  it('returns 404 when event is not found (stub adapter returns null)', async () => {
    const req = makeRequest('http://localhost:3000/api/events/nonexistent/seo')
    const res = await getEventSeo(req as any, {
      params: Promise.resolve({ eventId: 'nonexistent' }),
    })

    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toBe('Event not found')
  })

  it('returns 200 with SEO data when the service resolves', async () => {
    // To test the happy path we need the DB adapter to return data.
    // We spy on SeoService.prototype.generateEventSeo to return mock data.
    const { SeoService } = await import('@/services/seo.service')
    const mockSeo = {
      eventId: 'evt-1',
      slug: 'festival-xy-2026-praha',
      canonicalUrl: 'https://tixly.cz/akce/festival-xy-2026-praha',
      title: 'Festival XY — Vstupenky | 15. srpna 2026, Praha',
      description: 'Festival XY | 15. srpna 2026, Letňany Park, Praha',
      keywords: ['Festival XY', 'Praha', 'vstupenky'],
      ogTitle: 'Festival XY — Vstupenky | 15. srpna 2026, Praha',
      ogDescription: 'Festival XY | 15. srpna 2026, Letňany Park, Praha',
      ogImage: 'https://cdn.tixly.cz/festival-xy.jpg',
      ogType: 'event',
      schemaOrg: { '@context': 'https://schema.org', '@type': 'Event' },
      lastModified: new Date(),
      changeFreq: 'monthly',
      priority: 0.5,
    }

    const spy = vi
      .spyOn(SeoService.prototype, 'generateEventSeo')
      .mockResolvedValueOnce(mockSeo as any)

    const req = makeRequest('http://localhost:3000/api/events/evt-1/seo')
    const res = await getEventSeo(req as any, {
      params: Promise.resolve({ eventId: 'evt-1' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')

    const data = await res.json()
    expect(data.eventId).toBe('evt-1')
    expect(data.slug).toBe('festival-xy-2026-praha')
    expect(data.title).toContain('Festival XY')
    expect(data.schemaOrg).toBeDefined()

    spy.mockRestore()
  })

  it('returns 500 on unexpected errors', async () => {
    const { SeoService } = await import('@/services/seo.service')
    const spy = vi
      .spyOn(SeoService.prototype, 'generateEventSeo')
      .mockRejectedValueOnce(new Error('Database connection failed'))

    const req = makeRequest('http://localhost:3000/api/events/evt-1/seo')
    const res = await getEventSeo(req as any, {
      params: Promise.resolve({ eventId: 'evt-1' }),
    })

    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Failed to generate SEO data')

    spy.mockRestore()
  })
})

// ── GET /api/sitemap.xml ─────────────────────────────────────────────────────

describe('GET /api/sitemap.xml', () => {
  it('returns 200 with valid XML content type', async () => {
    const req = makeRequest('http://localhost:3000/api/sitemap.xml')
    const res = await getSitemapXml(req as any)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
  })

  it('returns valid XML sitemap structure (empty with stub adapter)', async () => {
    const req = makeRequest('http://localhost:3000/api/sitemap.xml')
    const res = await getSitemapXml(req as any)
    const body = await res.text()

    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(body).toContain('</urlset>')
  })

  it('returns sitemap with event URLs when service returns data', async () => {
    const { SeoService } = await import('@/services/seo.service')
    const mockXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '  <url>',
      '    <loc>https://tixly.cz/akce/festival-xy-2026-praha</loc>',
      '    <lastmod>2026-04-01</lastmod>',
      '    <changefreq>monthly</changefreq>',
      '    <priority>0.5</priority>',
      '  </url>',
      '</urlset>',
    ].join('\n')

    const spy = vi
      .spyOn(SeoService.prototype, 'generateSitemap')
      .mockResolvedValueOnce(mockXml)

    const req = makeRequest('http://localhost:3000/api/sitemap.xml')
    const res = await getSitemapXml(req as any)
    const body = await res.text()

    expect(body).toContain('festival-xy-2026-praha')
    expect(body).toContain('<loc>')

    spy.mockRestore()
  })

  it('returns 500 on unexpected errors', async () => {
    const { SeoService } = await import('@/services/seo.service')
    const spy = vi
      .spyOn(SeoService.prototype, 'generateSitemap')
      .mockRejectedValueOnce(new Error('DB error'))

    const req = makeRequest('http://localhost:3000/api/sitemap.xml')
    const res = await getSitemapXml(req as any)

    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Failed to generate sitemap')

    spy.mockRestore()
  })
})

// ── GET /api/robots.txt ──────────────────────────────────────────────────────

describe('GET /api/robots.txt', () => {
  it('returns 200 with text/plain content type', async () => {
    const req = makeRequest('http://localhost:3000/api/robots.txt')
    const res = await getRobotsTxt(req as any)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
  })

  it('contains required robots.txt directives', async () => {
    const req = makeRequest('http://localhost:3000/api/robots.txt')
    const res = await getRobotsTxt(req as any)
    const body = await res.text()

    expect(body).toContain('User-agent: *')
    expect(body).toContain('Allow: /')
    expect(body).toContain('Disallow: /api/')
    expect(body).toContain('Disallow: /admin/')
    expect(body).toContain('Disallow: /checkout/')
  })

  it('includes sitemap URL', async () => {
    const req = makeRequest('http://localhost:3000/api/robots.txt')
    const res = await getRobotsTxt(req as any)
    const body = await res.text()

    expect(body).toContain('Sitemap: https://tixly.cz/sitemap.xml')
  })

  it('returns 500 on unexpected errors', async () => {
    const { SeoService } = await import('@/services/seo.service')
    const spy = vi
      .spyOn(SeoService.prototype, 'generateRobotsTxt')
      .mockImplementationOnce(() => {
        throw new Error('Unexpected error')
      })

    const req = makeRequest('http://localhost:3000/api/robots.txt')
    const res = await getRobotsTxt(req as any)

    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Failed to generate robots.txt')

    spy.mockRestore()
  })
})
