'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Artist {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  cover_image_url: string | null;
  genres: string[];
  country: string | null;
  website_url: string | null;
  social_links: Record<string, string> | null;
  spotify_id: string | null;
}

interface ArtistEvent {
  id: string;
  title: string;
  slug: string;
  date_start: string;
  cover_image_url: string | null;
  category: string | null;
  venue_name: string;
  city: string;
  is_headliner: boolean;
  cheapest_ticket_halire: number | null;
  promoter_name: string;
}

export default function ArtistPage() {
  const { slug } = useParams<{ slug: string }>();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [events, setEvents] = useState<ArtistEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/artists/${slug}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); setLoading(false); return null; }
        return r.json() as Promise<{ artist: Artist; events: ArtistEvent[] }>;
      })
      .then(data => {
        if (!data) return;
        setArtist(data.artist);
        setEvents(data.events);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [slug]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Načítám...</div>;
  if (notFound) return (
    <div className="min-h-screen flex items-center justify-center text-center">
      <div>
        <div className="text-5xl mb-4">🎸</div>
        <h1 className="text-xl font-bold">Umělec nenalezen</h1>
        <Link href="/cs/events" className="text-indigo-400 underline mt-3 block">Zpět na akce</Link>
      </div>
    </div>
  );
  if (!artist) return null;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Hero */}
      <div className="relative h-64 sm:h-80 bg-gradient-to-b from-indigo-950 to-gray-950">
        {artist.cover_image_url && (
          <>
            <img src={artist.cover_image_url} alt={artist.name}
              className="absolute inset-0 w-full h-full object-cover opacity-30" />
            <div className="absolute inset-0 bg-gradient-to-t from-gray-950 to-transparent" />
          </>
        )}
        <div className="relative z-10 flex items-end h-full px-6 pb-6 max-w-5xl mx-auto">
          <div>
            <h1 className="text-4xl sm:text-5xl font-extrabold">{artist.name}</h1>
            {artist.country && <div className="text-gray-400 mt-1">{artist.country}</div>}
            {artist.genres.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {artist.genres.map(g => (
                  <span key={g} className="bg-indigo-900/60 text-indigo-300 text-xs px-3 py-1 rounded-full">{g}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left: Bio + Links */}
        <div className="md:col-span-1 space-y-4">
          {artist.bio && (
            <div>
              <h2 className="text-sm uppercase text-gray-500 tracking-wide mb-2">O umělci</h2>
              <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-line">{artist.bio}</p>
            </div>
          )}

          <div className="space-y-2">
            {artist.spotify_id && (
              <a
                href={`https://open.spotify.com/artist/${artist.spotify_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-green-400 hover:text-green-300 text-sm"
              >
                🎵 Spotify
              </a>
            )}
            {artist.website_url && (
              <a href={artist.website_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-gray-400 hover:text-white text-sm">
                🌐 Web
              </a>
            )}
            {artist.social_links && Object.entries(artist.social_links).map(([platform, url]) => (
              <a key={platform} href={url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-gray-400 hover:text-white text-sm capitalize">
                📱 {platform}
              </a>
            ))}
          </div>
        </div>

        {/* Right: Upcoming events */}
        <div className="md:col-span-2">
          <h2 className="text-lg font-semibold mb-4">Nadcházející vystoupení</h2>
          {events.length === 0 && (
            <p className="text-gray-500 text-sm">Žádné nadcházející akce</p>
          )}
          <div className="space-y-3">
            {events.map(ev => (
              <Link key={ev.id} href={`/cs/events/${ev.id}`}
                className="flex items-center gap-4 bg-gray-900 hover:bg-gray-800 rounded-xl p-3 transition-colors group">
                {ev.cover_image_url ? (
                  <img src={ev.cover_image_url} alt={ev.title}
                    className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-gray-800 flex items-center justify-center text-2xl flex-shrink-0">🎭</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium group-hover:text-indigo-300 transition-colors line-clamp-1">{ev.title}</div>
                  <div className="text-sm text-gray-400">
                    {new Date(ev.date_start).toLocaleDateString('cs', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>
                  <div className="text-sm text-gray-500">{ev.venue_name} · {ev.city}</div>
                  {ev.is_headliner && (
                    <span className="text-xs text-yellow-400">★ Headliner</span>
                  )}
                </div>
                {ev.cheapest_ticket_halire !== null ? (
                  <div className="text-sm font-medium text-indigo-300 flex-shrink-0">
                    od {(ev.cheapest_ticket_halire / 100).toFixed(0)} Kč
                  </div>
                ) : (
                  <div className="text-sm text-gray-500 flex-shrink-0">Vyprodáno</div>
                )}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
