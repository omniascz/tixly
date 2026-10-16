import type { MetadataRoute } from 'next';
import { Pool } from 'pg';
import { pgPoolOptions } from '@/lib/db/pg-options';
import { LOCALES_ACTIVE } from '@/lib/i18n';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
// Sitemap publikuje jen produkčně přeložené locales — vyhneme se duplicate
// content penalizaci v Google když 7 z 8 locales je hardcoded česky.
const LOCALES = LOCALES_ACTIVE;

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool(pgPoolOptions(process.env.DATABASE_URL));
  return pool;
}

// Kolo 11: bez dynamického vykreslení Next sitemapu předgeneroval při buildu (DB tam není → statická sitemap bez dat).
export const dynamic = 'force-dynamic';
export const revalidate = 3600; // re-generate hourly

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPaths = [
    { path: '', priority: 1.0, changeFrequency: 'daily' as const },
    { path: '/events', priority: 0.9, changeFrequency: 'hourly' as const },
    { path: '/events/map', priority: 0.8, changeFrequency: 'daily' as const },
    { path: '/blog', priority: 0.7, changeFrequency: 'daily' as const },
    { path: '/about', priority: 0.6, changeFrequency: 'monthly' as const },
    { path: '/contact', priority: 0.6, changeFrequency: 'monthly' as const },
    { path: '/loyalty', priority: 0.5, changeFrequency: 'monthly' as const },
    { path: '/tixly-plus', priority: 0.6, changeFrequency: 'weekly' as const },
    { path: '/api-docs', priority: 0.5, changeFrequency: 'monthly' as const },
    { path: '/legal/terms', priority: 0.3, changeFrequency: 'yearly' as const },
    { path: '/legal/privacy', priority: 0.3, changeFrequency: 'yearly' as const },
    { path: '/login', priority: 0.4, changeFrequency: 'yearly' as const },
    { path: '/register', priority: 0.4, changeFrequency: 'yearly' as const },
  ];

  const entries: MetadataRoute.Sitemap = [];
  for (const p of staticPaths) {
    for (const locale of LOCALES) {
      entries.push({
        url: `${BASE_URL}/${locale}${p.path}`,
        lastModified: new Date(),
        changeFrequency: p.changeFrequency,
        priority: p.priority,
        alternates: {
          languages: Object.fromEntries(
            LOCALES.map((l) => [l, `${BASE_URL}/${l}${p.path}`]),
          ),
        },
      });
    }
  }

  // Published, future events
  try {
    const events = await db().query<{ id: string; updated_at: string; date_start: string }>(
      `SELECT id, updated_at, date_start
       FROM catalog.events
       WHERE status = 'published' AND date_start > NOW() - INTERVAL '7 days'
       ORDER BY date_start ASC
       LIMIT 1000`,
    );
    for (const ev of events.rows) {
      for (const locale of LOCALES) {
        entries.push({
          url: `${BASE_URL}/${locale}/events/${ev.id}`,
          lastModified: new Date(ev.updated_at),
          changeFrequency: 'daily',
          priority: 0.8,
        });
      }
    }
  } catch (err) {
    console.error('[sitemap events]', err);
  }

  // Active promoter profile pages (/p/{slug}) — pro veřejné brand pages
  try {
    const promoters = await db().query<{ slug: string; updated_at: string }>(
      `SELECT slug, updated_at FROM platform.promoters
       WHERE status = 'active' AND slug IS NOT NULL
       ORDER BY updated_at DESC
       LIMIT 500`,
    );
    for (const p of promoters.rows) {
      for (const locale of LOCALES) {
        entries.push({
          url: `${BASE_URL}/${locale}/p/${p.slug}`,
          lastModified: new Date(p.updated_at),
          changeFrequency: 'weekly',
          priority: 0.7,
        });
      }
    }
  } catch (err) {
    console.error('[sitemap promoters]', err);
  }

  return entries;
}
