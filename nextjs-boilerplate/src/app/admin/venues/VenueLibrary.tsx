'use client';

/**
 * Kolo 8 / krok 2 — knihovna míst pořadatele: místo (název, město, adresa) → sál → plánek.
 * Sál uložený jednou se použije pro libovolný další termín.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Hall { id: string; name: string; capacity: number; hasChart: boolean; zones: Array<{ id: string; name: string; color: string }> }
interface Place { id: string; name: string; city: string; address: string | null; halls: Hall[] }

const api = (url: string, init?: RequestInit) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
};

export function VenueLibrary() {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [form, setForm] = useState({ name: '', city: '', address: '' });
  const [hallName, setHallName] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const r = await api('/api/admin/venue-places');
    if (r.ok) setPlaces(((await r.json()) as { places: Place[] }).places);
    else setErr(`Knihovnu míst nelze načíst (HTTP ${r.status}).`);
  }
  useEffect(() => { void load(); }, []);

  async function addPlace() {
    setErr(null);
    const r = await api('/api/admin/venue-places', { method: 'POST', body: JSON.stringify({ ...form, address: form.address || null }) });
    if (!r.ok) { setErr('Místo se nepodařilo uložit — vyplňte název a město.'); return; }
    setForm({ name: '', city: '', address: '' });
    await load();
  }

  async function addHall(placeId: string) {
    const name = (hallName[placeId] ?? '').trim();
    if (!name) return;
    const r = await api(`/api/admin/venue-places/${placeId}/halls`, { method: 'POST', body: JSON.stringify({ name }) });
    if (!r.ok) { setErr('Sál se nepodařilo uložit.'); return; }
    const j = (await r.json()) as { hall: { id: string } };
    window.location.href = `/admin/venues/${j.hall.id}/seating-chart/editor`;
  }

  return (
    <section className="mb-8 space-y-4" data-testid="venue-library">
      <h2 className="text-lg font-semibold">Knihovna míst</h2>
      {err ? <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800">{err}</p> : null}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
        <label className="text-sm">Místo<Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="např. Městské divadlo" data-testid="place-name" /></label>
        <label className="text-sm">Město<Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} data-testid="place-city" /></label>
        <label className="text-sm">Adresa<Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="place-address" /></label>
        <Button onClick={() => void addPlace()} disabled={!form.name.trim() || !form.city.trim()} data-testid="place-add">Přidat místo</Button>
      </div>
      {places === null ? <p className="text-sm text-muted-foreground">Načítám…</p> : places.length === 0 ? (
        <p className="text-sm text-muted-foreground">Zatím žádné místo. Přidejte divadlo nebo kulturní dům, pak v něm sály a jejich plánky.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {places.map((p) => (
            <div key={p.id} className="rounded-lg border bg-card p-4" data-testid="place-card">
              <div className="font-medium">{p.name}</div>
              <div className="text-sm text-muted-foreground">{[p.city, p.address].filter(Boolean).join(' · ')}</div>
              <ul className="mt-3 space-y-1 text-sm">
                {p.halls.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2">
                    <span>{h.name.replace(`${p.name} – `, '')} <span className="text-muted-foreground">· {h.hasChart ? `${h.capacity} míst, ${h.zones.length} zón` : 'bez plánku'}</span></span>
                    <Link href={`/admin/venues/${h.id}/seating-chart/editor`} className="font-medium text-primary hover:underline">Editor plánku</Link>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <Input className="h-8" placeholder="Nový sál (např. Velký sál)" value={hallName[p.id] ?? ''}
                  onChange={(e) => setHallName({ ...hallName, [p.id]: e.target.value })} data-testid="hall-name" />
                <Button size="sm" onClick={() => void addHall(p.id)} data-testid="hall-add">Přidat sál</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
