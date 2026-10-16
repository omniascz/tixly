import type { JSX } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { pgPoolOptions } from '@/lib/db/pg-options';
import { formatDate } from '@/lib/format';
import { isValidLocale, DEFAULT_LOCALE } from '@/lib/i18n';


interface ArtistRow {
  id: string;
  name: string;
  bio: string | null;
  cover_image_url: string | null;
}

interface PerformanceRow {
  event_id: string;
  event_title: string;
  event_slug: string | null;
  date_start: string;
  role_name: string;
  venue_name: string | null;
}

async function fetchActor(artistId: string): Promise<{
  artist: ArtistRow;
  performances: PerformanceRow[];
} | null> {
  const pool = new Pool(pgPoolOptions(process.env.DATABASE_URL));
  try {
    const aRes = await pool.query<ArtistRow>(
      `SELECT id, name, bio, cover_image_url
         FROM lineups.artists
        WHERE id = $1`,
      [artistId],
    );
    if (aRes.rows.length === 0) return null;

    const pRes = await pool.query<PerformanceRow>(
      `SELECT e.id AS event_id, e.title AS event_title, e.slug AS event_slug,
              e.date_start, pc.role_name,
              v.name AS venue_name
         FROM lineups.performance_cast pc
         JOIN catalog.events e ON e.id = pc.event_id
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
        WHERE pc.artist_id = $1
          AND pc.is_visible = true
          AND e.date_start > now()
          AND e.status = 'published'
        ORDER BY e.date_start ASC
        LIMIT 50`,
      [artistId],
    );

    return { artist: aRes.rows[0], performances: pRes.rows };
  } finally {
    await pool.end();
  }
}

export default async function ActorProfilePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<JSX.Element> {
  if (process.env.NEXT_PUBLIC_FEATURE_ACTOR_PROFILES !== 'true') {
    notFound();
  }

  const { locale, id } = await params;
  const resolvedLocale = isValidLocale(locale) ? locale : DEFAULT_LOCALE;

  const data = await fetchActor(id);
  if (!data) notFound();

  const { artist, performances } = data;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-start gap-6">
        {artist.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artist.cover_image_url}
            alt={artist.name}
            className="h-28 w-28 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="grid h-28 w-28 shrink-0 place-items-center rounded-full bg-muted text-3xl font-bold text-muted-foreground">
            {artist.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold">{artist.name}</h1>
          {artist.bio ? (
            <p className="mt-2 text-sm text-muted-foreground">{artist.bio}</p>
          ) : null}
        </div>
      </div>

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold">Nadcházející představení</h2>
        {performances.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žádná plánovaná představení.</p>
        ) : (
          <ul className="space-y-3">
            {performances.map((p) => {
              const href = p.event_slug
                ? `/${resolvedLocale}/p/${p.event_slug}`
                : `/${resolvedLocale}/events/${p.event_id}`;
              return (
                <li key={`${p.event_id}-${p.role_name}`} className="rounded-md border p-4">
                  <Link href={href} className="hover:underline">
                    <span className="font-medium">{p.event_title}</span>
                  </Link>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {formatDate(p.date_start)}
                    {p.venue_name ? ` · ${p.venue_name}` : ''}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Role: {p.role_name}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
