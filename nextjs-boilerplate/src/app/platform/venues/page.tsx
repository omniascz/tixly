'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

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

interface VenueRow {
  id: string;
  name: string;
  venue_type: string;
  city: string;
  country: string;
  address: string | null;
  capacity: number;
  status: 'draft' | 'published' | 'archived';
  photo_url: string | null;
  last_modified_at: string;
  last_modifier_email: string | null;
  has_seating_chart: boolean;
}

const STATUS_FILTERS: { value: '' | 'draft' | 'published' | 'archived'; label: string }[] = [
  { value: '', label: 'Vše' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

const VENUE_TYPES = [
  'venue', 'stadium', 'arena', 'cinema_hall', 'theatre_hall', 'club',
  'outdoor', 'fitness_studio', 'restaurant', 'coworking', 'conference_room', 'online',
];

export default function PlatformVenuesPage() {
  const [items, setItems] = useState<VenueRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | 'draft' | 'published' | 'archived'>('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('q', search);
      const res = await authFetch(`/api/platform/venues?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { venues: VenueRow[] };
      setItems(data.venues ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
  }, [statusFilter]);

  const counts = useMemo(() => {
    const c = { draft: 0, published: 0, archived: 0 };
    for (const v of items) c[v.status]++;
    return c;
  }, [items]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">📍 Sály a stadiony</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Master katalog míst — od malých klubů po velké stadiony. Promotéři vybírají z této knihovny;
            sami sály neupravují.
          </p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Zavřít' : '+ Nový sál'}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      {showCreate && <CreateForm onCreated={() => { setShowCreate(false); void load(); }} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Celkem" value={items.length} />
        <StatCard label="Draft" value={counts.draft} tone="amber" />
        <StatCard label="Published" value={counts.published} tone="emerald" />
        <StatCard label="Archived" value={counts.archived} tone="slate" />
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value || 'all'}
                onClick={() => setStatusFilter(f.value)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  statusFilter === f.value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background hover:bg-accent'
                }`}
              >
                {f.label}
              </button>
            ))}
            <form
              onSubmit={(e) => { e.preventDefault(); void load(); }}
              className="ml-auto flex gap-2"
            >
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Hledat name nebo city…"
                className="w-64"
              />
              <Button type="submit" variant="outline" size="sm">Hledat</Button>
            </form>
          </div>
          <CardTitle>{items.length} výsledků</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2">Sál</th>
                <th>Typ</th>
                <th>Město</th>
                <th className="text-right">Kapacita</th>
                <th>Status</th>
                <th>Seating</th>
                <th>Naposledy upravil</th>
                <th className="text-right">Akce</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    Žádné sály. Začni klikem na <strong>+ Nový sál</strong>.
                  </td>
                </tr>
              ) : (
                items.map((v) => (
                  <tr key={v.id} className="border-b hover:bg-muted/30">
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        {v.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={v.photo_url}
                            alt={v.name}
                            className="h-8 w-12 rounded object-cover"
                          />
                        ) : (
                          <div className="flex h-8 w-12 items-center justify-center rounded bg-muted text-xs">
                            📍
                          </div>
                        )}
                        <div>
                          <div className="font-medium">{v.name}</div>
                          <div className="text-xs text-muted-foreground">{v.id.slice(0, 8)}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <code className="rounded bg-muted px-1 text-xs">{v.venue_type}</code>
                    </td>
                    <td>
                      {v.city} <span className="text-muted-foreground">{v.country}</span>
                    </td>
                    <td className="text-right tabular-nums">{v.capacity.toLocaleString('cs-CZ')}</td>
                    <td><StatusBadge status={v.status} /></td>
                    <td>
                      {v.has_seating_chart ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">
                          ✓ aktivní
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {new Date(v.last_modified_at).toLocaleDateString('cs-CZ')}
                      {v.last_modifier_email && (
                        <div className="text-[10px]">{v.last_modifier_email}</div>
                      )}
                    </td>
                    <td className="text-right">
                      <Link
                        href={`/platform/venues/${v.id}/edit`}
                        className="text-xs text-primary hover:underline"
                      >
                        Upravit →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label, value, tone,
}: { label: string; value: number; tone?: 'amber' | 'emerald' | 'slate' }) {
  const colors = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  };
  return (
    <div className={`rounded-md border p-3 ${tone ? colors[tone] : 'bg-card'}`}>
      <div className="text-xs uppercase opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: VenueRow['status'] }) {
  const map: Record<VenueRow['status'], string> = {
    draft: 'bg-amber-100 text-amber-800',
    published: 'bg-emerald-100 text-emerald-800',
    archived: 'bg-slate-100 text-slate-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${map[status]}`}>
      {status}
    </span>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [venueType, setVenueType] = useState('venue');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('CZ');
  const [capacity, setCapacity] = useState('500');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await authFetch('/api/platform/venues', {
        method: 'POST',
        body: JSON.stringify({
          name,
          venueType,
          city,
          country,
          capacity: Number(capacity),
          address: address || undefined,
          status: 'draft',
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) {
        setErr(j.error ?? `HTTP ${res.status}`);
        return;
      }
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nový sál</CardTitle>
      </CardHeader>
      <CardContent>
        {err && (
          <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 p-2 text-sm text-rose-900">
            {err}
          </div>
        )}
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs uppercase text-muted-foreground">Název</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="O2 arena Praha"
              required
              minLength={2}
              maxLength={200}
            />
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
            <label className="mb-1 block text-xs uppercase text-muted-foreground">Kapacita</label>
            <Input
              type="number"
              min={1}
              max={500_000}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase text-muted-foreground">Město</label>
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
              minLength={1}
              maxLength={120}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase text-muted-foreground">Země (ISO-2)</label>
            <Input
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              maxLength={2}
              minLength={2}
              required
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs uppercase text-muted-foreground">Adresa (volitelné)</label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={500}
            />
          </div>
          <div className="md:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? 'Vytvářím…' : 'Vytvořit (jako draft)'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Po vytvoření se otevře editor — můžeš nahrát fotku, plánek a vytvořit seating chart.
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
