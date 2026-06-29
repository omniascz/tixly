'use client';

/**
 * /platform/travel — EVENTIM.Travel hotel catalog management
 *
 * Platform admin spravuje hotel catalog (přidání, editace, povolení/zakázání).
 * Hotely jsou venue-level — promoter pak k eventu připojí konkrétní hotel + termín.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Hotel {
  id: string;
  name: string;
  city: string | null;
  stars: number | null;
  active: boolean;
  cover_image_url: string | null;
  venue_name: string | null;
  room_count: number;
}

function authFetch(url: string, init?: RequestInit) {
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

export default function TravelHotelsPage() {
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', city: '', stars: '', address: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void authFetch('/api/platform/travel/hotels')
      .then((r) => r.json())
      .then((j: { hotels?: Hotel[] }) => setHotels(j.hotels ?? []))
      .catch(() => setError('Načtení selhalo.'))
      .finally(() => setLoading(false));
  }, []);

  async function create() {
    if (!form.name.trim()) { setError('Zadej název hotelu.'); return; }
    setSaving(true);
    setError(null);
    const res = await authFetch('/api/platform/travel/hotels', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name.trim(),
        city: form.city.trim() || null,
        stars: form.stars ? parseInt(form.stars) : null,
        address: form.address.trim() || null,
        description: form.description.trim() || null,
      }),
    });
    const j = (await res.json()) as { hotel?: Hotel; error?: string };
    if (!res.ok) { setError(j.error ?? 'Vytvoření selhalo.'); setSaving(false); return; }
    if (j.hotel) setHotels((prev) => [j.hotel!, ...prev]);
    setForm({ name: '', city: '', stars: '', address: '', description: '' });
    setShowForm(false);
    setSaving(false);
  }

  async function toggleActive(hotel: Hotel) {
    await authFetch(`/api/platform/travel/hotels/${hotel.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !hotel.active }),
    });
    setHotels((prev) => prev.map((h) => h.id === hotel.id ? { ...h, active: !h.active } : h));
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Načítám…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">EVENTIM.Travel — Hotel katalog</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Spravuj hotely, které promotéři mohou připojit ke svým eventům jako travel balíčky.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Zrušit' : '+ Přidat hotel'}
        </Button>
      </div>

      {error ? <div className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}

      {showForm ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Nový hotel</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Název *</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Marriott Praha" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Město</label>
              <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} placeholder="Praha" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Hvězdy (1–5)</label>
              <Input type="number" min={1} max={5} value={form.stars} onChange={(e) => setForm((f) => ({ ...f, stars: e.target.value }))} placeholder="4" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Adresa</label>
              <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="V Celnici 8, Praha 1" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium">Popis</label>
              <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Krátký popis výhod hotelu…" />
            </div>
            <div className="sm:col-span-2">
              <Button onClick={() => void create()} disabled={saving}>{saving ? 'Ukládám…' : 'Vytvořit hotel'}</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {hotels.map((h) => (
          <Card key={h.id} className={!h.active ? 'opacity-60' : ''}>
            <CardContent className="pt-4">
              {h.cover_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={h.cover_image_url} alt={h.name} className="mb-3 h-32 w-full rounded-md object-cover" />
              ) : (
                <div className="mb-3 flex h-32 items-center justify-center rounded-md bg-muted text-3xl">🏨</div>
              )}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{h.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {h.stars ? '★'.repeat(h.stars) : ''} {h.city ?? ''}
                    {h.venue_name ? ` · ${h.venue_name}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{h.room_count} typ{h.room_count === 1 ? '' : 'y'} pokojů</p>
                </div>
                <Badge variant={h.active ? 'secondary' : 'outline'}>
                  {h.active ? 'Aktivní' : 'Neaktivní'}
                </Badge>
              </div>
              <div className="mt-3 flex gap-2">
                <Link href={`/platform/travel/${h.id}`} className="flex-1">
                  <Button variant="outline" size="sm" className="w-full">Spravovat</Button>
                </Link>
                <Button size="sm" variant="ghost" onClick={() => void toggleActive(h)}>
                  {h.active ? 'Deaktivovat' : 'Aktivovat'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {hotels.length === 0 && !loading ? (
          <p className="col-span-full text-center text-sm text-muted-foreground py-12">Zatím žádné hotely. Přidej první.</p>
        ) : null}
      </div>
    </div>
  );
}
