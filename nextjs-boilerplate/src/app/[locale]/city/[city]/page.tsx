/**
 * /[locale]/city/[city] — City-based event browse.
 *
 * Národní portál UX: kupec klikne "Praha" → vidí všechny published akce
 * v Praze napříč všemi promotéry, řazené podle data.
 */
import Link from 'next/link';
import { Pool } from 'pg';
import { pgPoolOptions } from '@/lib/db/pg-options';
import { Calendar, MapPin } from 'lucide-react';
import { formatCzechDate } from '@/lib/format';

interface PageProps {
  params: Promise<{ locale: string; city: string }>;
}

interface EventRow {
  id: string;
  title: string;
  slug: string | null;
  date_start: string;
  venue_name: string | null;
  city: string;
  category: string | null;
  promoter_name: string;
  cover_image_url: string | null;
}

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool(pgPoolOptions(process.env.DATABASE_URL));
  return pool;
}

async function fetchEventsByCity(city: string): Promise<EventRow[]> {
  const r = await db().query<EventRow>(
    `SELECT e.id, e.title, e.slug, e.date_start::text,
            v.name AS venue_name, v.city, e.category,
            p.name AS promoter_name, e.cover_image_url
       FROM catalog.events e
  LEFT JOIN catalog.venues v ON v.id = e.venue_id
       JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE e.status = 'published'
        AND p.status = 'active'
        AND LOWER(v.city) = LOWER($1)
        AND e.date_start >= now()
   ORDER BY e.date_start
      LIMIT 200`,
    [city],
  );
  return r.rows;
}

async function fetchCityStats(city: string): Promise<{
  upcoming: number;
  promoters: number;
  venues: number;
}> {
  const r = await db().query<{ upcoming: string; promoters: string; venues: string }>(
    `SELECT
        COUNT(DISTINCT e.id)::text AS upcoming,
        COUNT(DISTINCT e.promoter_id)::text AS promoters,
        COUNT(DISTINCT v.id)::text AS venues
       FROM catalog.events e
  LEFT JOIN catalog.venues v ON v.id = e.venue_id
       JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE e.status = 'published'
        AND p.status = 'active'
        AND LOWER(v.city) = LOWER($1)
        AND e.date_start >= now()`,
    [city],
  );
  return {
    upcoming: Number(r.rows[0]?.upcoming ?? 0),
    promoters: Number(r.rows[0]?.promoters ?? 0),
    venues: Number(r.rows[0]?.venues ?? 0),
  };
}

export default async function CityPage({ params }: PageProps): Promise<JSX.Element> {
  const { locale, city } = await params;
  const decodedCity = decodeURIComponent(city);
  const [events, stats] = await Promise.all([
    fetchEventsByCity(decodedCity),
    fetchCityStats(decodedCity),
  ]);

  const cityLabel = decodedCity.charAt(0).toUpperCase() + decodedCity.slice(1);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8">
        <h1 className="flex items-center gap-3 text-3xl font-bold">
          <MapPin className="h-7 w-7 text-primary" />
          Akce v {cityLabel}
        </h1>
        <div className="mt-3 flex gap-6 text-sm text-muted-foreground">
          <span><strong className="text-foreground">{stats.upcoming}</strong> nadcházejících akcí</span>
          <span><strong className="text-foreground">{stats.promoters}</strong> pořadatelů</span>
          <span><strong className="text-foreground">{stats.venues}</strong> míst konání</span>
        </div>
      </header>

      {events.length === 0 ? (
        <p className="rounded-md border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          V {cityLabel} momentálně nejsou žádné nadcházející akce.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => (
            <Link
              key={e.id}
              href={`/${locale}/events/${e.id}`}
              className="overflow-hidden rounded-lg border bg-card transition hover:border-primary"
            >
              {e.cover_image_url ? (
                <div className="aspect-video bg-muted">
                  <img
                    src={e.cover_image_url}
                    alt={e.title}
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : null}
              <div className="p-4">
                <p className="text-xs uppercase text-muted-foreground">{e.category ?? 'Akce'}</p>
                <h3 className="mt-1 font-semibold leading-tight">{e.title}</h3>
                <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatCzechDate(e.date_start)}
                </p>
                {e.venue_name ? (
                  <p className="mt-1 text-xs text-muted-foreground">{e.venue_name}</p>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}

      <footer className="mt-12 rounded-md border bg-muted/30 p-4 text-xs text-muted-foreground">
        <p>
          Tahle stránka je generovaná automaticky ze všech aktivních promotérů Tixly v {cityLabel}.
          Subscribuj iCal feed:
          {' '}
          <a
            href={`/api/v1/feed/events.ics?city=${encodeURIComponent(decodedCity)}`}
            className="text-primary hover:underline"
          >
            tixly-{decodedCity}.ics
          </a>
        </p>
      </footer>
    </main>
  );
}
