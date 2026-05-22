'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Connection {
  connected: boolean;
  isMock: boolean;
  displayName?: string;
  connectedAt?: string;
  topArtists?: Array<{ name: string; rank: number; genres: string[] }>;
}

interface DiscoverEvent {
  eventId: string;
  title: string;
  dateStart: string;
  coverImageUrl: string | null;
  score: number;
  matchedArtists: string[];
  matchedGenres: string[];
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const userId = typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(userId ? { 'x-user-id': userId } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function DiscoverPage(): JSX.Element {
  const [conn, setConn] = useState<Connection | null>(null);
  const [events, setEvents] = useState<DiscoverEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setError(null);
    try {
      const c = await authFetch('/api/buyer/spotify/connect');
      if (c.ok) {
        const data = (await c.json()) as Connection;
        setConn(data);
        if (data.connected) {
          const d = await authFetch('/api/buyer/discover/events');
          if (d.ok) {
            const dData = (await d.json()) as { events: DiscoverEvent[] };
            setEvents(dData.events);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Síťová chyba');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function connect(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const r = await authFetch('/api/buyer/spotify/connect', { method: 'POST', body: '{}' });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
        setError(b.message ?? b.error ?? `HTTP ${r.status}`);
        return;
      }
      const body = (await r.json()) as {
        isMock: boolean;
        authorizeUrl?: string;
      };
      // Real OAuth → redirect na Spotify authorize. Po callback se buyer
      // vrátí na /cs/discover?connected=1.
      if (!body.isMock && body.authorizeUrl) {
        window.location.href = body.authorizeUrl;
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    if (!window.confirm('Odpojit Spotify? Doporučení zmizí.')) return;
    setBusy(true);
    try {
      await authFetch('/api/buyer/spotify/connect', { method: 'DELETE' });
      setConn({ connected: false, isMock: true });
      setEvents([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-3xl font-bold">Doporučené koncerty</h1>
        <p className="text-sm text-muted-foreground">
          Připoj Spotify a uvidíš akce s umělci, které posloucháš — nebo
          podobné žánrově.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {!conn?.connected ? (
        <Card>
          <CardHeader>
            <CardTitle>Připoj Spotify</CardTitle>
            <CardDescription>
              Použijeme tvůj seznam top umělců + žánrů pro doporučení.
              Žádné posty na tvůj profil, žádné sdílení dat.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => void connect()} disabled={busy} data-testid="spotify-connect">
              {busy ? 'Připojuji…' : '🎵 Připojit Spotify'}
            </Button>
            {conn?.isMock ? (
              <p className="mt-2 text-xs text-muted-foreground">
                <strong>Demo režim:</strong> Spotify OAuth není v dev. Po kliknutí dostaneš mock seed (5 CZ umělců).
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Připojeno</CardTitle>
              <CardDescription>
                {conn.displayName}
                {conn.isMock ? ' (mock režim)' : ''} — {conn.topArtists?.length ?? 0} top umělců
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5" data-testid="top-artists">
                {conn.topArtists?.slice(0, 10).map((a) => (
                  <span
                    key={a.rank}
                    className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900"
                  >
                    #{a.rank} {a.name}
                  </span>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={() => void disconnect()}>
                Odpojit
              </Button>
            </CardContent>
          </Card>

          <div>
            <h2 className="mb-3 text-xl font-semibold">
              Doporučeno pro tebe ({events.length})
            </h2>
            {events.length === 0 ? (
              <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
                Žádné nadcházející akce neodpovídají tvému music profilu.
                Možná je čas objevit nové žánry — projdi{' '}
                <Link href="/cs/events" className="underline">
                  všechny akce
                </Link>
                .
              </p>
            ) : (
              <div className="space-y-3">
                {events.map((ev) => (
                  <Card
                    key={ev.eventId}
                    className="hover:border-primary/40 transition"
                    data-testid={`discover-event-${ev.eventId}`}
                  >
                    <CardContent className="flex items-start gap-3 py-3">
                      {ev.coverImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={ev.coverImageUrl}
                          alt=""
                          className="h-16 w-16 rounded-md object-cover"
                        />
                      ) : null}
                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/cs/events/${ev.eventId}`}
                          className="font-semibold hover:underline"
                        >
                          {ev.title}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {new Date(ev.dateStart).toLocaleString('cs-CZ', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {ev.matchedArtists.slice(0, 3).map((a) => (
                            <span
                              key={a}
                              className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900"
                              title="Posloucháš tohoto umělce"
                            >
                              ★ {a}
                            </span>
                          ))}
                          {ev.matchedGenres.slice(0, 2).map((g) => (
                            <span
                              key={g}
                              className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900"
                              title="Žánr, který posloucháš"
                            >
                              ♪ {g}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div
                        className="text-xs font-mono text-muted-foreground"
                        title="Match score"
                      >
                        {Math.round(ev.score)}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
