'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { VenueLayoutPreview } from '@/components/platform/VenueLayoutPreview';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { classifyChartSize } from '@/lib/seating/perf';

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

interface VenueDetail {
  id: string;
  name: string;
  venue_type: string;
  city: string;
  country: string;
  address: string | null;
  capacity: number;
  gps_lat: string | null;
  gps_lng: string | null;
  photo_url: string | null;
  floor_plan_url: string | null;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  archived_at: string | null;
  created_at: string;
  last_modified_at: string;
  last_modifier_email: string | null;
  seating_chart_count: number;
  has_active_seating_chart: boolean;
  upcoming_events_count: number;
}

const VENUE_TYPES = [
  'venue', 'stadium', 'arena', 'cinema_hall', 'theatre_hall', 'club',
  'outdoor', 'fitness_studio', 'restaurant', 'coworking', 'conference_room', 'online',
];

export default function PlatformVenueEditPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // editable fields
  const [name, setName] = useState('');
  const [venueType, setVenueType] = useState('venue');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('CZ');
  const [address, setAddress] = useState('');
  const [capacity, setCapacity] = useState('500');
  const [gpsLat, setGpsLat] = useState('');
  const [gpsLng, setGpsLng] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [floorPlanUrl, setFloorPlanUrl] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'draft' | 'published' | 'archived'>('draft');

  async function load() {
    setError(null);
    try {
      const res = await authFetch(`/api/platform/venues/${params.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { venue: VenueDetail };
      const v = data.venue;
      setVenue(v);
      setName(v.name);
      setVenueType(v.venue_type);
      setCity(v.city);
      setCountry(v.country);
      setAddress(v.address ?? '');
      setCapacity(String(v.capacity));
      setGpsLat(v.gps_lat ?? '');
      setGpsLng(v.gps_lng ?? '');
      setPhotoUrl(v.photo_url ?? '');
      setFloorPlanUrl(v.floor_plan_url ?? '');
      setDescription(v.description ?? '');
      setStatus(v.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
  }, [params.id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!venue) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const payload: Record<string, unknown> = {
        name, venueType, city, country, capacity: Number(capacity), status,
        address: address || null,
        gpsLat: gpsLat ? Number(gpsLat) : null,
        gpsLng: gpsLng ? Number(gpsLng) : null,
        photoUrl: photoUrl || null,
        floorPlanUrl: floorPlanUrl || null,
        description: description || null,
      };
      const res = await authFetch(`/api/platform/venues/${venue.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!venue) return;
    if (!confirm(`Opravdu archivovat sál "${venue.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/platform/venues/${venue.id}`, { method: 'DELETE' });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string; upcomingEvents?: number;
      };
      if (!res.ok) {
        setError(
          j.upcomingEvents
            ? `Nelze archivovat: ${j.upcomingEvents} nadcházejících akcí používá tento sál.`
            : (j.error ?? `HTTP ${res.status}`),
        );
        return;
      }
      router.push('/platform/venues');
    } finally {
      setBusy(false);
    }
  }

  async function transitionStatus(next: 'draft' | 'published' | 'archived') {
    if (!venue) return;
    if (next === venue.status) return;
    if (next === 'published' && !venue.has_active_seating_chart && venue.seating_chart_count === 0) {
      if (!confirm(
        'Sál ještě nemá žádný seating chart. Publikovat i tak? ' +
        '(Pro velké stadiony doporučujeme nejprve vytvořit chart.)',
      )) return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/platform/venues/${venue.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setStatus(next);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error && !venue) {
    return (
      <div className="space-y-4">
        <Link href="/platform/venues" className="text-sm text-primary hover:underline">
          ← Zpět na seznam sálů
        </Link>
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      </div>
    );
  }
  if (!venue) {
    return <p className="text-sm text-muted-foreground">Načítám…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/platform/venues" className="text-sm text-primary hover:underline">
          ← Zpět na seznam sálů
        </Link>
        <h1 className="mt-2 text-3xl font-bold">{venue.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ID <code className="rounded bg-muted px-1">{venue.id}</code>
          {' · '}vytvořeno {new Date(venue.created_at).toLocaleDateString('cs-CZ')}
          {' · '}upravil{' '}
          {venue.last_modifier_email ?? 'systém'}{' '}
          {new Date(venue.last_modified_at).toLocaleString('cs-CZ')}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          ✓ Uloženo
        </div>
      )}

      {/* Status workflow */}
      <Card>
        <CardHeader>
          <CardTitle>Stav publikování</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill current={status} value="draft" onClick={() => transitionStatus('draft')} disabled={busy}>
              📝 Draft
            </StatusPill>
            <span className="text-muted-foreground">→</span>
            <StatusPill current={status} value="published" onClick={() => transitionStatus('published')} disabled={busy}>
              🌍 Published
            </StatusPill>
            <span className="text-muted-foreground">→</span>
            <StatusPill current={status} value="archived" onClick={() => transitionStatus('archived')} disabled={busy}>
              🗄 Archived
            </StatusPill>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Pouze <strong>published</strong> sály se zobrazí v promotér selectu. Archivované zůstávají v
            DB pro historické akce.
          </p>
        </CardContent>
      </Card>

      {/* Seating chart */}
      <Card className={venue.has_active_seating_chart ? 'border-emerald-200' : 'border-amber-200'}>
        <CardHeader>
          <CardTitle>🪑 Seating chart</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {venue.has_active_seating_chart ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">
                    ✓ aktivní
                  </span>
                  <span className="text-muted-foreground">
                    {venue.seating_chart_count} verz{venue.seating_chart_count === 1 ? 'e' : 'í'} celkem
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/platform/venues/${venue.id}/seating-chart/editor`}>
                    <Button size="sm">🎨 Upravit ve visual editoru</Button>
                  </Link>
                  <Link href={`/platform/venues/${venue.id}/seating-chart/tools`}>
                    <Button size="sm" variant="outline">🛠 Sector tools</Button>
                  </Link>
                  <Link href={`/platform/venues/${venue.id}/seating-chart/import`}>
                    <Button size="sm" variant="outline">📥 Import nový</Button>
                  </Link>
                  <Link href={`/platform/venues/${venue.id}/seating-chart/versions`}>
                    <Button size="sm" variant="outline">📜 Historie</Button>
                  </Link>
                </div>
              </div>

              <VenueLayoutPreview venueId={venue.id} maxHeight={500} />

              <p className="text-xs text-muted-foreground">
                Promotéři při vytváření akce vidí tento layout (read-only). Edituje pouze master admin.
              </p>
            </>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-amber-900">
                ⚠ Tento sál ještě nemá aktivní seating chart.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/platform/venues/${venue.id}/seating-chart/editor`}>
                  <Button size="sm">🎨 Vytvořit ve visual editoru</Button>
                </Link>
                <Link href={`/platform/venues/${venue.id}/seating-chart`}>
                  <Button size="sm" variant="outline">📐 Grid builder (rovnoměrné)</Button>
                </Link>
                <Link href={`/platform/venues/${venue.id}/seating-chart/import`}>
                  <Button size="sm" variant="outline">📥 Import CSV/SVG</Button>
                </Link>
              </div>
              <ul className="ml-4 list-disc text-xs text-muted-foreground">
                <li>
                  <strong>Pre-mapped sály</strong> (Camp Nou, O2 arena, smsticket export) — Import
                </li>
                <li>
                  <strong>Tužkové plány / nepravidelné</strong> — Visual editor (drag-and-draw)
                </li>
                <li>
                  <strong>Pravidelné mřížky</strong> — Grid builder
                </li>
              </ul>
              <p className="text-xs text-muted-foreground">
                Bez chartu lze sál publikovat jen pro <em>general admission</em> akce (capacity-based).
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Performance hint pro big stadiums */}
      <PerfHintPanel capacity={venue.capacity} />

      {/* Used by upcoming events */}
      {venue.upcoming_events_count > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>📅 Aktivní použití</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              <strong>{venue.upcoming_events_count}</strong> nadcházejících akcí používá tento sál. Změny se
              promítnou do všech (kromě capacity — to je per-event).
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Sál nelze archivovat, dokud existují nadcházející akce.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Edit form */}
      <form onSubmit={save} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Základní údaje</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Název</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={200} />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Typ</label>
              <select
                value={venueType}
                onChange={(e) => setVenueType(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {VENUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Kapacita
              </label>
              <Input
                type="number"
                min={1}
                max={500_000}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                required
                disabled={venue.has_active_seating_chart}
                className={venue.has_active_seating_chart ? 'bg-muted/40' : ''}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {venue.has_active_seating_chart ? (
                  <>
                    🔒 Kapacita je odvozená ze seating chartu ({capacity} sedadel) — automaticky
                    se aktualizuje při změně chartu. Pro úpravu uprav chart ve{' '}
                    <Link
                      href={`/platform/venues/${venue.id}/seating-chart/editor`}
                      className="text-primary hover:underline"
                    >
                      visual editoru
                    </Link>.
                  </>
                ) : (
                  <>Pro GA (stojící) sály bez chartu. Při importu/uložení chartu se přepíše počtem sedadel.</>
                )}
              </p>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Popis</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                rows={3}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lokace</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Město</label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} required minLength={1} maxLength={120} />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Země (ISO-2)</label>
              <Input
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                minLength={2}
                maxLength={2}
                required
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Adresa</label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">GPS Lat</label>
              <Input
                type="number"
                step="0.0000001"
                min={-90}
                max={90}
                value={gpsLat}
                onChange={(e) => setGpsLat(e.target.value)}
                placeholder="50.1027"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">GPS Lng</label>
              <Input
                type="number"
                step="0.0000001"
                min={-180}
                max={180}
                value={gpsLng}
                onChange={(e) => setGpsLng(e.target.value)}
                placeholder="14.4914"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vizuály</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Photo URL</label>
              <Input
                type="url"
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
                maxLength={500}
                placeholder="https://…"
              />
              {photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="preview" className="mt-2 h-32 w-full rounded object-cover" />
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Floor plan URL
              </label>
              <Input
                type="url"
                value={floorPlanUrl}
                onChange={(e) => setFloorPlanUrl(e.target.value)}
                maxLength={500}
                placeholder="https://…/plan.svg"
              />
              {floorPlanUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={floorPlanUrl} alt="floor plan preview" className="mt-2 h-32 w-full rounded bg-white object-contain" />
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Pro tužkové plánky / scany — bude použit jako pozadí ve vizuálním editoru.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between gap-3 rounded-md border bg-card p-4">
          <Button type="submit" disabled={busy}>
            {busy ? 'Ukládám…' : '💾 Uložit změny'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={archive}
            disabled={busy || venue.upcoming_events_count > 0}
            className="text-rose-700 hover:bg-rose-50"
          >
            🗄 Archivovat
          </Button>
        </div>
      </form>
    </div>
  );
}

function PerfHintPanel({ capacity }: { capacity: number }) {
  const hint = classifyChartSize(capacity);
  if (hint.level === 'ok') return null;
  const tone = {
    caution: 'border-blue-200 bg-blue-50/40',
    warning: 'border-amber-200 bg-amber-50/40',
    critical: 'border-rose-200 bg-rose-50/40',
  }[hint.level] ?? '';
  const icon = { caution: 'ℹ️', warning: '⚠️', critical: '🚨' }[hint.level] ?? '';
  return (
    <Card className={tone}>
      <CardHeader>
        <CardTitle>{icon} Performance hint</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>{hint.message}</p>
        {hint.recommendations.length > 0 && (
          <ul className="ml-4 list-disc text-xs text-muted-foreground">
            {hint.recommendations.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function StatusPill({
  current, value, onClick, disabled, children,
}: {
  current: string;
  value: 'draft' | 'published' | 'archived';
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || active}
      className={`rounded-full border px-3 py-1.5 text-sm transition ${
        active
          ? 'border-primary bg-primary font-medium text-primary-foreground'
          : 'border-border bg-background hover:bg-accent disabled:opacity-50'
      }`}
    >
      {children}
    </button>
  );
}
