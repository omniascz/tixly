import type { MetadataRoute } from 'next'
import { SeoService } from '@/services/seo.service'
import type { SeoDbAdapter } from '@/services/seo.service'

// ---------------------------------------------------------------------------
// Replace with real DB adapter.
// ---------------------------------------------------------------------------
const db: SeoDbAdapter = {
  getEventForSeo: async (_id) => null,
  getTicketTypesForSeo: async (_id) => [],
  getAllActiveEvents: async () => [],
}

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://tixly.cz'
const seoService = new SeoService()

/**
 * Next.js 14 dynamic sitemap.
 * Revalidation is handled by Next.js — set `revalidate` on this route if
 * you need time-based ISR (e.g. `export const revalidate = 3600`).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const events = await db.getAllActiveEvents()
  const now = new Date()

  return events.map((event) => {
    const daysUntilEvent =
      (event.date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)

    const changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] =
      daysUntilEvent < 7
        ? 'daily'
        : daysUntilEvent < 60
          ? 'weekly'
          : 'monthly'

    // Re-use the same priority logic as the XML generator
    const priority = (() => {
      if (event.status === 'cancelled') return 0.1
      const soldOut = event.capacity > 0 && event.ticketsSold >= event.capacity
      if (soldOut) return 0.3
      if (daysUntilEvent < 30) return 0.9
      if (daysUntilEvent < 90) return 0.7
      return 0.5
    })()

    return {
      url: `${BASE_URL}/akce/${event.slug}`,
      lastModified: event.updatedAt,
      changeFrequency,
      priority,
    }
  })
}

// Export the XML string variant for use outside Next.js (e.g. standalone API).
export async function generateSitemapXml(): Promise<string> {
  return seoService.generateSitemap(BASE_URL, db)
}
