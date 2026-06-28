'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MapEvent } from './LeafletMap';

// Leaflet je browser-only — dynamicky importujeme bez SSR
const LeafletMap = dynamic(() => import('./LeafletMap'), {
  ssr:     false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-100 text-sm text-muted-foreground">
      Načítání mapy…
    </div>
  ),
});

const CATEGORY_LABELS: Record<string, string> = {
  music:      'Hudba',
  concert:    'Koncert',
  classical:  'Klasická hudba',
  theatre:    'Divadlo',
  comedy:     'Komedie',
  sport:      'Sport',
  conference: 'Konference',
  family:     'Rodina',
  club:       'Klub / párty',
  gastro:     'Gastronomie',
  exhibition: 'Výstava',
  education:  'Vzdělávání',
};

const PERIOD_OPTIONS = [
  { label: 'Vše',          value: '' },
  { label: 'Dnes',         value: 'today' },
  { label: 'Tento týden',  value: 'week' },
  { label: 'Tento měsíc',  value: 'month' },
];

// Výchozí střed ČR
const DEFAULT_CENTER: [number, number] = [49.8, 15.5];
const DEFAULT_ZOOM = 7;

function periodToDates(period: string): { dateFrom?: string; dateTo?: string } {
  if (!period) return {};
  const now   = new Date();
  const today = now.toISOString().slice(0, 10);
  if (period === 'today') return { dateFrom: today, dateTo: today };
  if (period === 'week') {
    const next = new Date(now);
    next.setDate(now.getDate() + 7);
    return { dateFrom: today, dateTo: next.toISOString().slice(0, 10) };
  }
  if (period === 'month') {
    const next = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    return { dateFrom: today, dateTo: next.toISOString().slice(0, 10) };
  }
  return {};
}

function formatPrice(h: number | null): string {
  if (h === null) return '';
  return `od ${(h / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('cs-CZ', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function EventsMapClient({ locale }: { locale: string }) {
  const [events,    setEvents]    = useState<MapEvent[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [geoError,  setGeoError]  = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Filtry
  const [cityInput,  setCityInput]  = useState('');
  const [category,   setCategory]   = useState('');
  const [period,     setPeriod]     = useState('');
  const [availCats,  setAvailCats]  = useState<string[]>([]);

  // Mapa — střed a zoom
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [mapZoom,   setMapZoom]   = useState(DEFAULT_ZOOM);

  // Ref pro scroll sidebaru
  const listRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const load = useCallback(async (opts?: {
    lat?: number; lng?: number; city?: string;
    category?: string; period?: string;
  }) => {
    setLoading(true);
    setGeoError(null);
    try {
      const p = new URLSearchParams();
      const cat = opts?.category !== undefined ? opts.category : category;
      const per = opts?.period   !== undefined ? opts.period   : period;

      if (opts?.lat !== undefined && opts.lng !== undefined) {
        p.set('lat', String(opts.lat));
        p.set('lng', String(opts.lng));
        p.set('radius', '80');
      } else if (opts?.city) {
        p.set('city', opts.city);
      }
      if (cat) p.set('category', cat);
      const { dateFrom, dateTo } = periodToDates(per);
      if (dateFrom) p.set('dateFrom', dateFrom);
      if (dateTo)   p.set('dateTo', dateTo);

      const res = await fetch(`/api/events/nearby?${p.toString()}`);
      if (!res.ok) return;
      const j = await res.json() as {
        events: MapEvent[];
        center: { lat: number; lng: number } | null;
        categories: string[];
      };

      const withGps = j.events.filter((e) => e.lat !== null && e.lng !== null);
      setEvents(withGps);
      setAvailCats(j.categories);

      if (j.center) {
        setMapCenter([j.center.lat, j.center.lng]);
        setMapZoom(11);
      } else if (withGps.length > 0 && opts?.city) {
        setMapCenter([withGps[0].lat, withGps[0].lng]);
        setMapZoom(10);
      }
    } finally {
      setLoading(false);
    }
  }, [category, period]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function useGeolocation() {
    if (!navigator.geolocation) {
      setGeoError('Geolokace není v tomto prohlížeči podporována.');
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setMapCenter([latitude, longitude]);
        setMapZoom(11);
        void load({ lat: latitude, lng: longitude });
      },
      () => {
        setLoading(false);
        setGeoError('Přístup k poloze odepřen nebo vypršel čas.');
      },
      { timeout: 8000 },
    );
  }

  function handleCitySearch() {
    const c = cityInput.trim();
    if (!c) return;
    void load({ city: c });
  }

  function handleCategoryToggle(cat: string) {
    const next = category === cat ? '' : cat;
    setCategory(next);
    void load({ category: next });
  }

  function handlePeriod(p: string) {
    setPeriod(p);
    void load({ period: p });
  }

  // Scroll list na hovered item
  useEffect(() => {
    if (hoveredId) {
      listRefs.current.get(hoveredId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [hoveredId]);

  return (
    <div className="flex flex-col gap-4">
      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={useGeolocation} disabled={loading} className="gap-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
            <line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
            <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
          </svg>
          Akce poblíž
        </Button>

        <div className="flex gap-1">
          <Input
            placeholder="Město…"
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCitySearch()}
            className="h-8 w-32 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleCitySearch}
            disabled={loading || !cityInput.trim()}
          >
            Hledat
          </Button>
        </div>

        {/* Period chips */}
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handlePeriod(opt.value)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                period === opt.value
                  ? 'bg-emerald-600 text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs text-muted-foreground">
          {loading ? 'Načítám…' : `${events.length} ${events.length === 1 ? 'akce' : 'akcí'}`}
        </span>
      </div>

      {/* Category filter chips */}
      {availCats.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {availCats.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => handleCategoryToggle(cat)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                category === cat
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted'
              }`}
            >
              {CATEGORY_LABELS[cat] ?? cat}
            </button>
          ))}
        </div>
      )}

      {geoError && (
        <p className="rounded border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
          {geoError}
        </p>
      )}

      {/* Map + sidebar */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
        {/* Leaflet mapa */}
        <div className="relative h-[520px] overflow-hidden rounded-xl border shadow-sm lg:h-[620px]">
          <LeafletMap
            events={events}
            center={mapCenter}
            zoom={mapZoom}
            locale={locale}
            hoveredId={hoveredId}
            onHover={setHoveredId}
          />
        </div>

        {/* Sidebar seznam */}
        <div className="flex max-h-[620px] flex-col overflow-y-auto rounded-xl border bg-card shadow-sm">
          {events.length === 0 && !loading ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <p className="text-sm text-muted-foreground">Žádné akce v tomto zobrazení.</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setCategory('');
                  setPeriod('');
                  setCityInput('');
                  setMapCenter(DEFAULT_CENTER);
                  setMapZoom(DEFAULT_ZOOM);
                  void load({ category: '', period: '' });
                }}
              >
                Zobrazit vše v ČR
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {events.map((ev) => (
                <div
                  key={ev.id}
                  ref={(el) => {
                    if (el) listRefs.current.set(ev.id, el);
                    else listRefs.current.delete(ev.id);
                  }}
                  onMouseEnter={() => setHoveredId(ev.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={`transition-colors ${
                    hoveredId === ev.id ? 'bg-blue-50' : 'hover:bg-muted/40'
                  }`}
                >
                  <Link
                    href={`/${locale}/events/${ev.slug ?? ev.id}`}
                    className="flex gap-3 p-3"
                  >
                    {ev.coverImage ? (
                      <img
                        src={ev.coverImage}
                        alt=""
                        className="h-14 w-14 flex-none rounded-md object-cover"
                      />
                    ) : (
                      <div className="h-14 w-14 flex-none rounded-md bg-gradient-to-br from-emerald-400 to-blue-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold leading-tight">{ev.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {formatDate(ev.dateStart)}
                      </div>
                      {ev.venueName && (
                        <div className="truncate text-xs text-muted-foreground">
                          📍 {ev.venueName}{ev.city ? `, ${ev.city}` : ''}
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {ev.category && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium">
                            {CATEGORY_LABELS[ev.category] ?? ev.category}
                          </span>
                        )}
                        {ev.cheapestPriceHalire !== null && (
                          <span className="text-xs font-medium text-emerald-700">
                            {formatPrice(ev.cheapestPriceHalire)}
                          </span>
                        )}
                        {ev.distanceKm !== null && (
                          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                            {ev.distanceKm} km
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Mapa:{' '}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          © OpenStreetMap contributors
        </a>
        . Zobrazeno max. 300 akcí.
      </p>
    </div>
  );
}
