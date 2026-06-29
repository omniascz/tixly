'use client';

/**
 * /admin/events/[id]/travel — EVENTIM.Travel balíčky pro event
 *
 * Promotér přidá hotel + termín k eventu. Buyer si vybere během checkoutu.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface TravelPackage {
  id: string;
  hotel_name: string;
  city: string | null;
  stars: number | null;
  room_name: string;
  checkin_date: string;
  checkout_date: string;
  nights: number;
  total_capacity: number;
  reserved_count: number;
  effective_price_per_night: number;
  active: boolean;
  display_order: number;
}

interface AvailableHotel {
  id: string;
  name: string;
  city: string | null;
  stars: number | null;
}

interface AvailableRoom {
  id: string;
  name: string;
  capacity: number;
  price_per_night_halire: number;
  breakfast_included: boolean;
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

export default function EventTravelPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [packages, setPackages] = useState<TravelPackage[]>([]);
  const [hotels, setHotels] = useState<AvailableHotel[]>([]);
  const [rooms, setRooms] = useState<AvailableRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    hotelId: '',
    hotelRoomId: '',
    checkinDate: '',
    checkoutDate: '',
    totalCapacity: '0',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void Promise.all([
      authFetch(`/api/admin/events/${eventId}/travel`).then((r) => r.json()),
      authFetch('/api/platform/travel/hotels').then((r) => r.json()),
    ]).then(([pkgData, hotelData]: [{ packages?: TravelPackage[] }, { hotels?: AvailableHotel[] }]) => {
      setPackages(pkgData.packages ?? []);
      setHotels((hotelData.hotels ?? []).filter((h) => (h as unknown as { active: boolean }).active !== false));
    }).catch(() => setError('Načtení selhalo.')).finally(() => setLoading(false));
  }, [eventId]);

  useEffect(() => {
    if (!form.hotelId) { setRooms([]); return; }
    void authFetch(`/api/platform/travel/hotels/${form.hotelId}`)
      .then((r) => r.json())
      .then((j: { rooms?: AvailableRoom[] }) => setRooms((j.rooms ?? []).filter((r) => (r as unknown as { active: boolean }).active !== false)));
  }, [form.hotelId]);

  async function addPackage() {
    if (!form.hotelId || !form.hotelRoomId || !form.checkinDate || !form.checkoutDate) {
      setError('Vyplň hotel, pokoj a termíny.'); return;
    }
    setSaving(true);
    setError(null);
    const res = await authFetch(`/api/admin/events/${eventId}/travel`, {
      method: 'POST',
      body: JSON.stringify({
        hotelId: form.hotelId,
        hotelRoomId: form.hotelRoomId,
        checkinDate: form.checkinDate,
        checkoutDate: form.checkoutDate,
        totalCapacity: parseInt(form.totalCapacity) || 0,
      }),
    });
    const j = (await res.json()) as { packageId?: string; error?: string };
    if (!res.ok) { setError(j.error ?? 'Přidání selhalo.'); setSaving(false); return; }
    setFeedback('Balíček přidán. Kupující ho uvidí v checkoutu.');
    setShowForm(false);
    setForm({ hotelId: '', hotelRoomId: '', checkinDate: '', checkoutDate: '', totalCapacity: '0' });
    // Reload
    const fresh = await authFetch(`/api/admin/events/${eventId}/travel`).then((r) => r.json()) as { packages?: TravelPackage[] };
    setPackages(fresh.packages ?? []);
    setSaving(false);
  }

  async function toggleActive(pkg: TravelPackage) {
    await authFetch(`/api/admin/events/${eventId}/travel/${pkg.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !pkg.active }),
    });
    setPackages((prev) => prev.map((p) => p.id === pkg.id ? { ...p, active: !p.active } : p));
  }

  async function removePackage(pkg: TravelPackage) {
    const res = await authFetch(`/api/admin/events/${eventId}/travel/${pkg.id}`, { method: 'DELETE' });
    const j = (await res.json()) as { error?: string; message?: string };
    if (!res.ok) { setError(j.message ?? j.error ?? 'Smazání selhalo.'); return; }
    setPackages((prev) => prev.filter((p) => p.id !== pkg.id));
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Načítám…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href={`/admin/events/${eventId}`} className="text-sm text-primary hover:underline">← Zpět na event</Link>
          <h1 className="mt-1 text-2xl font-bold">EVENTIM.Travel — ubytování</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Přidej hotelové balíčky k tomuto eventu. Kupující si vybere hotel + pokoj přímo
            v checkout procesu. Cena ubytování se přičte k ceně vstupenky.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)} disabled={hotels.length === 0}>
          {showForm ? 'Zrušit' : '+ Přidat balíček'}
        </Button>
      </div>

      {hotels.length === 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Zatím nejsou žádné hotely v katalogu. Požádej platform admina o přidání hotelu.
        </div>
      ) : null}

      {error ? <div className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}
      {feedback ? <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{feedback}</div> : null}

      {showForm ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Nový travel balíček</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Hotel *</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.hotelId}
                onChange={(e) => setForm((f) => ({ ...f, hotelId: e.target.value, hotelRoomId: '' }))}
              >
                <option value="">— Vyber hotel —</option>
                {hotels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}{h.stars ? ` (${h.stars}★)` : ''}{h.city ? ` · ${h.city}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Typ pokoje *</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.hotelRoomId}
                onChange={(e) => setForm((f) => ({ ...f, hotelRoomId: e.target.value }))}
                disabled={!form.hotelId || rooms.length === 0}
              >
                <option value="">— Vyber pokoj —</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {fmtPrice(r.price_per_night_halire)}/noc · {r.capacity} os.{r.breakfast_included ? ' · snídaně' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Check-in *</label>
              <Input type="date" value={form.checkinDate} onChange={(e) => setForm((f) => ({ ...f, checkinDate: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Check-out *</label>
              <Input type="date" value={form.checkoutDate} onChange={(e) => setForm((f) => ({ ...f, checkoutDate: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Kapacita (0 = neomezená)</label>
              <Input type="number" min={0} value={form.totalCapacity} onChange={(e) => setForm((f) => ({ ...f, totalCapacity: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <Button onClick={() => void addPackage()} disabled={saving}>{saving ? 'Ukládám…' : 'Přidat balíček'}</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {packages.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Žádné travel balíčky. Klikni &quot;Přidat balíček&quot; pro přidání ubytování k eventu.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {packages.map((pkg) => (
            <Card key={pkg.id} className={!pkg.active ? 'opacity-60' : ''}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{pkg.hotel_name}{pkg.stars ? ` ${'★'.repeat(pkg.stars)}` : ''}</p>
                    <p className="text-sm text-muted-foreground">{pkg.room_name}</p>
                  </div>
                  <Badge variant={pkg.active ? 'secondary' : 'outline'}>{pkg.active ? 'Aktivní' : 'Vypnuto'}</Badge>
                </div>
                <div className="mt-2 space-y-0.5 text-sm">
                  <p>📅 {pkg.checkin_date} → {pkg.checkout_date} ({pkg.nights} nocí)</p>
                  <p>💰 {fmtPrice(pkg.effective_price_per_night)}/noc = <strong>{fmtPrice(pkg.effective_price_per_night * pkg.nights)}</strong></p>
                  <p>🛏 Rezervací: {pkg.reserved_count}/{pkg.total_capacity === 0 ? '∞' : pkg.total_capacity}</p>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void toggleActive(pkg)}>
                    {pkg.active ? 'Vypnout' : 'Zapnout'}
                  </Button>
                  {pkg.reserved_count === 0 ? (
                    <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => void removePackage(pkg)}>
                      Smazat
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
