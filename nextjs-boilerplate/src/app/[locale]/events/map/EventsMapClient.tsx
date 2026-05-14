'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface NearbyEvent {
  id: string;
  title: string;
  slug: string | null;
  dateStart: string;
  city: string | null;
  venueName: string | null;
  lat: number | null;
  lng: number | null;
  eventType: string | null;
  cheapestPriceHalire: number | null;
  distanceKm: number | null;
}

function formatPrice(halire: number | null): string {
  if (halire === null) return '—';
  return `od ${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

export function EventsMapClient({ locale }: { locale: string }) {
  const [events, setEvents] = useState<NearbyEvent[]>([]);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(50);
  const [city, setCity] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(opts?: { lat?: number; lng?: number; cityFilter?: string }): Promise<void> {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (opts?.lat !== undefined && opts.lng !== undefined) {
        params.set('lat', String(opts.lat));
        params.set('lng', String(opts.lng));
        params.set('radius', String(radius));
        setCenter({ lat: opts.lat, lng: opts.lng });
      } else if (opts?.cityFilter) {
        params.set('city', opts.cityFilter);
        setCenter(null);
      }
      const res = await fetch(`/api/events/nearby?${params.toString()}`);
      if (res.ok) {
        const j = (await res.json()) as { events: NearbyEvent[]; center: typeof center };
        setEvents(j.events.filter((e) => e.lat !== null && e.lng !== null));
        if (j.center) setCenter({ lat: j.center.lat, lng: j.center.lng });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function useGeolocation(): void {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => void load({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => undefined,
      { timeout: 5000 },
    );
  }

  // Bounding box pro SVG render (jednoduchý fallback bez Leaflet/Google Maps).
  const bbox = useMemo(() => {
    if (events.length === 0) return null;
    const lats = events.map((e) => e.lat!).filter((n) => isFinite(n));
    const lngs = events.map((e) => e.lng!).filter((n) => isFinite(n));
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const padLat = (maxLat - minLat) * 0.1 || 0.1;
    const padLng = (maxLng - minLng) * 0.1 || 0.1;
    return {
      minLat: minLat - padLat,
      maxLat: maxLat + padLat,
      minLng: minLng - padLng,
      maxLng: maxLng + padLng,
    };
  }, [events]);

  function projectX(lng: number): number {
    if (!bbox) return 0;
    return ((lng - bbox.minLng) / (bbox.maxLng - bbox.minLng)) * 100;
  }
  function projectY(lat: number): number {
    if (!bbox) return 0;
    return (1 - (lat - bbox.minLat) / (bbox.maxLat - bbox.minLat)) * 100;
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
      {/* Map (SVG fallback — bez external deps. V budoucnu Leaflet/Google) */}
      <Card>
        <CardContent className="p-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={useGeolocation} disabled={loading}>
              📍 Akce poblíž
            </Button>
            <Input
              placeholder="Město (Praha, Brno…)"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && city.trim()) {
                  void load({ cityFilter: city.trim() });
                }
              }}
              className="w-40"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load({ cityFilter: city.trim() })}
              disabled={loading || !city.trim()}
            >
              Hledat
            </Button>
            {center ? (
              <span className="text-xs text-muted-foreground">
                radius {radius} km · {events.length} akcí
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">{events.length} akcí</span>
            )}
          </div>

          <div className="relative aspect-[4/3] overflow-hidden rounded-md border bg-emerald-50">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
              {events.map((e) =>
                e.lat === null || e.lng === null ? null : (
                  <g
                    key={e.id}
                    transform={`translate(${projectX(e.lng)} ${projectY(e.lat)})`}
                    onMouseEnter={() => setHover(e.id)}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle
                      r={hover === e.id ? 2 : 1.2}
                      fill={hover === e.id ? '#dc2626' : '#10b981'}
                      stroke="white"
                      strokeWidth={0.3}
                    />
                  </g>
                ),
              )}
            </svg>
            {events.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                {loading ? 'Načítání…' : 'Žádné akce v této oblasti'}
              </div>
            ) : null}
          </div>

          <p className="mt-2 text-[11px] text-muted-foreground">
            Tip: pro plnohodnotnou mapu (Leaflet/Google) přidej{' '}
            <code>npm install leaflet react-leaflet</code> a nahraď SVG fallback.
          </p>
        </CardContent>
      </Card>

      {/* Event list */}
      <div className="max-h-[700px] space-y-2 overflow-y-auto">
        {events.map((e) => (
          <Link
            key={e.id}
            href={`/${locale}/events/${e.slug ?? e.id}`}
            onMouseEnter={() => setHover(e.id)}
            onMouseLeave={() => setHover(null)}
            className={`block rounded-md border bg-card p-3 text-sm transition hover:bg-muted ${
              hover === e.id ? 'border-rose-400 bg-rose-50' : ''
            }`}
          >
            <div className="font-medium">{e.title}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {new Date(e.dateStart).toLocaleString('cs-CZ', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
              {e.venueName ? ` · ${e.venueName}` : ''}
              {e.city ? ` · ${e.city}` : ''}
            </div>
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {e.distanceKm !== null ? `${e.distanceKm} km` : ''}
              </span>
              <span className="font-medium">{formatPrice(e.cheapestPriceHalire)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
