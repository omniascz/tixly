'use client';

/**
 * /platform/travel/[hotelId] — detail hotelu + správa typů pokojů
 */

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Room {
  id: string;
  name: string;
  capacity: number;
  price_per_night_halire: number;
  breakfast_included: boolean;
  description: string | null;
  sort_order: number;
  active: boolean;
}

interface Hotel {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  stars: number | null;
  description: string | null;
  cover_image_url: string | null;
  website_url: string | null;
  active: boolean;
  venue_name: string | null;
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

function fmtPrice(halire: number) {
  return `${(halire / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 0 })} Kč`;
}

export default function HotelDetailPage(props: { params: Promise<{ hotelId: string }> }) {
  const params = use(props.params);
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [roomForm, setRoomForm] = useState({
    name: '', capacity: '2', pricePerNight: '', breakfastIncluded: false, description: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void authFetch(`/api/platform/travel/hotels/${params.hotelId}`)
      .then((r) => r.json())
      .then((j: { hotel?: Hotel; rooms?: Room[] }) => {
        if (j.hotel) setHotel(j.hotel);
        setRooms(j.rooms ?? []);
      })
      .catch(() => setError('Načtení selhalo.'))
      .finally(() => setLoading(false));
  }, [params.hotelId]);

  async function addRoom() {
    if (!roomForm.name.trim()) { setError('Zadej název pokoje.'); return; }
    const price = Math.round(parseFloat(roomForm.pricePerNight) * 100);
    if (!price || price < 0) { setError('Zadej platnou cenu za noc.'); return; }
    setSaving(true);
    setError(null);
    const res = await authFetch(`/api/platform/travel/hotels/${params.hotelId}/rooms`, {
      method: 'POST',
      body: JSON.stringify({
        name: roomForm.name.trim(),
        capacity: parseInt(roomForm.capacity) || 2,
        pricePerNightHalire: price,
        breakfastIncluded: roomForm.breakfastIncluded,
        description: roomForm.description.trim() || null,
      }),
    });
    const j = (await res.json()) as { room?: Room; error?: string };
    if (!res.ok) { setError(j.error ?? 'Vytvoření selhalo.'); setSaving(false); return; }
    if (j.room) setRooms((prev) => [...prev, j.room!]);
    setRoomForm({ name: '', capacity: '2', pricePerNight: '', breakfastIncluded: false, description: '' });
    setShowRoomForm(false);
    setSaving(false);
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Načítám…</div>;
  if (!hotel) return <div className="p-6 text-sm text-rose-700">Hotel nenalezen.</div>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/platform/travel" className="text-sm text-primary hover:underline">← Zpět na katalog</Link>
        <h1 className="mt-1 text-2xl font-bold">{hotel.name}</h1>
        <p className="text-sm text-muted-foreground">
          {hotel.stars ? '★'.repeat(hotel.stars) + ' · ' : ''}{hotel.city ?? ''}{hotel.address ? ` · ${hotel.address}` : ''}
        </p>
      </div>

      {error ? <div className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            Typy pokojů
            <Button size="sm" onClick={() => setShowRoomForm((v) => !v)}>
              {showRoomForm ? 'Zrušit' : '+ Přidat pokoj'}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {showRoomForm ? (
            <div className="rounded-md border bg-muted/30 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium">Název pokoje *</label>
                  <Input
                    value={roomForm.name}
                    onChange={(e) => setRoomForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Dvoulůžkový Deluxe"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Kapacita (osob)</label>
                  <Input
                    type="number" min={1} max={10}
                    value={roomForm.capacity}
                    onChange={(e) => setRoomForm((f) => ({ ...f, capacity: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Cena za noc (Kč) *</label>
                  <Input
                    type="number" min={0}
                    value={roomForm.pricePerNight}
                    onChange={(e) => setRoomForm((f) => ({ ...f, pricePerNight: e.target.value }))}
                    placeholder="2990"
                  />
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <input
                    type="checkbox"
                    id="breakfast"
                    checked={roomForm.breakfastIncluded}
                    onChange={(e) => setRoomForm((f) => ({ ...f, breakfastIncluded: e.target.checked }))}
                  />
                  <label htmlFor="breakfast" className="text-sm">Snídaně v ceně</label>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium">Popis</label>
                  <Input
                    value={roomForm.description}
                    onChange={(e) => setRoomForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Výhled na náměstí, king-size postel…"
                  />
                </div>
              </div>
              <Button className="mt-3" onClick={() => void addRoom()} disabled={saving}>
                {saving ? 'Ukládám…' : 'Přidat pokoj'}
              </Button>
            </div>
          ) : null}

          {rooms.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádné typy pokojů.</p>
          ) : (
            <div className="divide-y">
              {rooms.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-sm">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.capacity} os. · {fmtPrice(r.price_per_night_halire)}/noc
                      {r.breakfast_included ? ' · snídaně ✓' : ''}
                    </p>
                    {r.description ? <p className="mt-0.5 text-xs text-muted-foreground">{r.description}</p> : null}
                  </div>
                  <span className="text-sm font-semibold text-amber-600">{fmtPrice(r.price_per_night_halire)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Info o hotelu</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1 text-muted-foreground">
          {hotel.description ? <p>{hotel.description}</p> : null}
          {hotel.website_url ? (
            <p>Web: <a href={hotel.website_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{hotel.website_url}</a></p>
          ) : null}
          {hotel.venue_name ? <p>Vázaný sál: {hotel.venue_name}</p> : null}
          <p>Status: {hotel.active ? '✅ Aktivní' : '⛔ Neaktivní'}</p>
        </CardContent>
      </Card>
    </div>
  );
}
