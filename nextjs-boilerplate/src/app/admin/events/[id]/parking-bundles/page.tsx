'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParkingOffer {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  distance_meters: number | null;
  vehicle_types: string[];
  height_limit_cm: number | null;
  price_halire: number;
  capacity: number;
  reserved_count: number;
  access_instructions: string | null;
  booking_deadline: string | null;
  confirmation_prefix: string;
  active: boolean;
  sort_order: number;
}

interface AccommodationOffer {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  distance_meters: number | null;
  stars: number | null;
  room_type: string;
  breakfast_included: boolean;
  price_per_night_halire: number;
  base_nights: number;
  check_in_date: string | null;
  check_out_date: string | null;
  partner_url: string | null;
  cancellation_policy: string | null;
  active: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (h: number) => `${(h / 100).toFixed(0)} Kč`;
const stars = (n: number | null) => n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '—';

const VEHICLE_OPTS = ['car', 'motorcycle', 'bus', 'ev'];
const ROOM_TYPES = ['single', 'double', 'twin', 'suite', 'family'];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ParkingBundlesPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const [tab, setTab] = useState<'parking' | 'accommodation'>('parking');

  const [parking, setParking] = useState<ParkingOffer[]>([]);
  const [accommodation, setAccommodation] = useState<AccommodationOffer[]>([]);
  const [loading, setLoading] = useState(true);

  const [showParkingForm, setShowParkingForm] = useState(false);
  const [showAccomForm, setShowAccomForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Parking form state
  const [pName, setPName] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [pAddress, setPAddress] = useState('');
  const [pLat, setPLat] = useState('');
  const [pLng, setPLng] = useState('');
  const [pDist, setPDist] = useState('');
  const [pVehicles, setPVehicles] = useState<string[]>(['car']);
  const [pHeight, setPHeight] = useState('');
  const [pPrice, setPPrice] = useState('');
  const [pCapacity, setPCapacity] = useState('');
  const [pInstructions, setPInstructions] = useState('');
  const [pPrefix, setPPrefix] = useState('PKG');

  // Accommodation form state
  const [aName, setAName] = useState('');
  const [aDesc, setADesc] = useState('');
  const [aAddress, setAAddress] = useState('');
  const [aLat, setALat] = useState('');
  const [aLng, setALng] = useState('');
  const [aDist, setADist] = useState('');
  const [aStars, setAStars] = useState('');
  const [aRoomType, setARoomType] = useState('double');
  const [aBreakfast, setABreakfast] = useState(false);
  const [aPrice, setAPrice] = useState('');
  const [aNights, setANights] = useState('1');
  const [aCheckIn, setACheckIn] = useState('');
  const [aCheckOut, setACheckOut] = useState('');
  const [aUrl, setAUrl] = useState('');
  const [aCancel, setACancel] = useState('');

  async function loadAll() {
    setLoading(true);
    const [pR, aR] = await Promise.all([
      fetch(`/api/admin/events/${eventId}/parking-bundle`).then((r) => r.json()) as Promise<{ offers: ParkingOffer[] }>,
      fetch(`/api/admin/events/${eventId}/accommodation-bundle`).then((r) => r.json()) as Promise<{ offers: AccommodationOffer[] }>,
    ]);
    setParking(pR.offers ?? []);
    setAccommodation(aR.offers ?? []);
    setLoading(false);
  }

  useEffect(() => { void loadAll(); }, [eventId]);

  async function handleParkingCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr('');
    const r = await fetch(`/api/admin/events/${eventId}/parking-bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: pName, description: pDesc || undefined,
        address: pAddress || undefined,
        lat: pLat ? parseFloat(pLat) : undefined,
        lng: pLng ? parseFloat(pLng) : undefined,
        distance_meters: pDist ? parseInt(pDist) : undefined,
        vehicle_types: pVehicles,
        height_limit_cm: pHeight ? parseInt(pHeight) : undefined,
        price_halire: Math.round(parseFloat(pPrice || '0') * 100),
        capacity: parseInt(pCapacity || '0'),
        access_instructions: pInstructions || undefined,
        confirmation_prefix: pPrefix || 'PKG',
      }),
    });
    if (r.ok) {
      setShowParkingForm(false);
      setPName(''); setPDesc(''); setPAddress(''); setPLat(''); setPLng('');
      setPDist(''); setPVehicles(['car']); setPHeight(''); setPPrice('');
      setPCapacity(''); setPInstructions(''); setPPrefix('PKG');
      await loadAll();
    } else {
      const d = await r.json() as { error?: string };
      setErr(d.error ?? 'Chyba');
    }
    setSaving(false);
  }

  async function handleAccomCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr('');
    const r = await fetch(`/api/admin/events/${eventId}/accommodation-bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: aName, description: aDesc || undefined,
        address: aAddress || undefined,
        lat: aLat ? parseFloat(aLat) : undefined,
        lng: aLng ? parseFloat(aLng) : undefined,
        distance_meters: aDist ? parseInt(aDist) : undefined,
        stars: aStars ? parseInt(aStars) : undefined,
        room_type: aRoomType,
        breakfast_included: aBreakfast,
        price_per_night_halire: Math.round(parseFloat(aPrice || '0') * 100),
        base_nights: parseInt(aNights || '1'),
        check_in_date: aCheckIn || undefined,
        check_out_date: aCheckOut || undefined,
        partner_url: aUrl || undefined,
        cancellation_policy: aCancel || undefined,
      }),
    });
    if (r.ok) {
      setShowAccomForm(false);
      setAName(''); setADesc(''); setAAddress(''); setALat(''); setALng('');
      setADist(''); setAStars(''); setARoomType('double'); setABreakfast(false);
      setAPrice(''); setANights('1'); setACheckIn(''); setACheckOut('');
      setAUrl(''); setACancel('');
      await loadAll();
    } else {
      const d = await r.json() as { error?: string };
      setErr(d.error ?? 'Chyba');
    }
    setSaving(false);
  }

  async function toggleActive(type: 'parking' | 'accommodation', id: string, active: boolean) {
    const ep = type === 'parking'
      ? `/api/admin/events/${eventId}/parking-bundle/${id}`
      : `/api/admin/events/${eventId}/accommodation-bundle/${id}`;
    await fetch(ep, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    });
    await loadAll();
  }

  async function deleteOffer(type: 'parking' | 'accommodation', id: string) {
    if (!confirm('Smazat nabídku?')) return;
    const ep = type === 'parking'
      ? `/api/admin/events/${eventId}/parking-bundle/${id}`
      : `/api/admin/events/${eventId}/accommodation-bundle/${id}`;
    await fetch(ep, { method: 'DELETE' });
    await loadAll();
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Parking & Ubytování Bundle</h1>
        <p className="text-slate-500 text-sm mt-1">
          Zákazníci si mohou při nákupu vstupenek přikoupit parkovací místo nebo ubytování.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(['parking', 'accommodation'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'parking' ? '🚗 Parkoviště' : '🏨 Ubytování'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">Načítám…</div>
      ) : (
        <>
          {/* ── PARKING TAB ── */}
          {tab === 'parking' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button
                  onClick={() => { setShowParkingForm(!showParkingForm); setErr(''); }}
                  className="bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  + Přidat parkoviště
                </button>
              </div>

              {showParkingForm && (
                <form onSubmit={handleParkingCreate} className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
                  <h3 className="font-semibold text-slate-900">Nové parkoviště</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">Název *</label>
                      <input required value={pName} onChange={(e) => setPName(e.target.value)}
                        placeholder="Parkoviště P1 – 200 m od vstupu"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">Popis</label>
                      <input value={pDesc} onChange={(e) => setPDesc(e.target.value)}
                        placeholder="Hlídané parkoviště, kryté"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">Adresa</label>
                      <input value={pAddress} onChange={(e) => setPAddress(e.target.value)}
                        placeholder="Náměstí Republiky 1, Praha 1"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">GPS Lat</label>
                      <input type="number" step="0.0000001" value={pLat} onChange={(e) => setPLat(e.target.value)}
                        placeholder="50.0835494"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">GPS Lng</label>
                      <input type="number" step="0.0000001" value={pLng} onChange={(e) => setPLng(e.target.value)}
                        placeholder="14.4341414"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Vzdálenost od vstupu (m)</label>
                      <input type="number" value={pDist} onChange={(e) => setPDist(e.target.value)}
                        placeholder="200"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Max výška vozidla (cm)</label>
                      <input type="number" value={pHeight} onChange={(e) => setPHeight(e.target.value)}
                        placeholder="210"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Cena (Kč)</label>
                      <input type="number" step="1" min="0" required value={pPrice} onChange={(e) => setPPrice(e.target.value)}
                        placeholder="150"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Kapacita (0 = neomezená)</label>
                      <input type="number" min="0" value={pCapacity} onChange={(e) => setPCapacity(e.target.value)}
                        placeholder="50"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Prefix kódu</label>
                      <input value={pPrefix} onChange={(e) => setPPrefix(e.target.value.toUpperCase())}
                        placeholder="PKG" maxLength={6}
                        className="w-full border rounded-lg px-3 py-2 text-sm font-mono" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Typy vozidel</label>
                      <div className="flex gap-2 flex-wrap pt-1">
                        {VEHICLE_OPTS.map((v) => (
                          <label key={v} className="flex items-center gap-1 text-sm">
                            <input type="checkbox" checked={pVehicles.includes(v)}
                              onChange={(e) => setPVehicles(e.target.checked
                                ? [...pVehicles, v]
                                : pVehicles.filter((x) => x !== v))} />
                            {v}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Instrukce k vjezdu (zobrazí se zákazníkovi s QR kódem)
                      </label>
                      <textarea value={pInstructions} onChange={(e) => setPInstructions(e.target.value)}
                        rows={2} placeholder="Vjezd z ul. XY, brána č. 3 – přiložte QR kód ke čtečce"
                        className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />
                    </div>
                  </div>
                  {err && <div className="text-sm text-red-600">{err}</div>}
                  <div className="flex gap-2">
                    <button type="submit" disabled={saving}
                      className="bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                      {saving ? 'Ukládám…' : 'Přidat parkoviště'}
                    </button>
                    <button type="button" onClick={() => setShowParkingForm(false)}
                      className="px-4 py-2 border rounded-lg text-sm text-slate-600">
                      Zrušit
                    </button>
                  </div>
                </form>
              )}

              {parking.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <div className="text-4xl mb-3">🚗</div>
                  <div>Žádná parkovací nabídka</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {parking.map((p) => (
                    <div key={p.id} className={`bg-white border rounded-xl p-4 ${!p.active ? 'opacity-60' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-900">🚗 {p.name}</span>
                            {p.distance_meters && (
                              <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                                {p.distance_meters} m od vstupu
                              </span>
                            )}
                            {!p.active && (
                              <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Neaktivní</span>
                            )}
                          </div>
                          {p.description && <div className="text-sm text-slate-500 mt-0.5">{p.description}</div>}
                          {p.address && <div className="text-xs text-slate-400 mt-0.5">📍 {p.address}</div>}
                          <div className="flex gap-4 mt-1 text-sm">
                            <span className="font-semibold text-emerald-700">{fmt(p.price_halire)}</span>
                            {p.capacity > 0 && (
                              <span className="text-slate-500">
                                {p.reserved_count}/{p.capacity} rezervováno
                              </span>
                            )}
                            {p.vehicle_types.length > 0 && (
                              <span className="text-slate-400">{p.vehicle_types.join(', ')}</span>
                            )}
                            {p.height_limit_cm && (
                              <span className="text-slate-400">max {p.height_limit_cm} cm</span>
                            )}
                          </div>
                          {p.access_instructions && (
                            <div className="mt-1 text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded">
                              {p.access_instructions}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => void toggleActive('parking', p.id, p.active)}
                            className={`text-xs px-3 py-1.5 rounded-lg border ${
                              p.active
                                ? 'text-slate-600 border-slate-300 hover:bg-slate-50'
                                : 'text-emerald-700 border-emerald-300 hover:bg-emerald-50'
                            }`}
                          >
                            {p.active ? 'Deaktivovat' : 'Aktivovat'}
                          </button>
                          <button
                            onClick={() => void deleteOffer('parking', p.id)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                          >
                            Smazat
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── ACCOMMODATION TAB ── */}
          {tab === 'accommodation' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button
                  onClick={() => { setShowAccomForm(!showAccomForm); setErr(''); }}
                  className="bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  + Přidat ubytování
                </button>
              </div>

              {showAccomForm && (
                <form onSubmit={handleAccomCreate} className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
                  <h3 className="font-semibold text-slate-900">Nové ubytování</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">Název *</label>
                      <input required value={aName} onChange={(e) => setAName(e.target.value)}
                        placeholder="Hotel Marriott Praha – 500 m od arény"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">Popis</label>
                      <input value={aDesc} onChange={(e) => setADesc(e.target.value)}
                        placeholder="Luxusní hotel v centru Prahy"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">Adresa</label>
                      <input value={aAddress} onChange={(e) => setAAddress(e.target.value)}
                        placeholder="V Celnici 8, 110 00 Praha 1"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">GPS Lat</label>
                      <input type="number" step="0.0000001" value={aLat} onChange={(e) => setALat(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">GPS Lng</label>
                      <input type="number" step="0.0000001" value={aLng} onChange={(e) => setALng(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Vzdálenost od akce (m)</label>
                      <input type="number" value={aDist} onChange={(e) => setADist(e.target.value)}
                        placeholder="500"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Hvězdičky (1–5)</label>
                      <select value={aStars} onChange={(e) => setAStars(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm">
                        <option value="">— nezadáno —</option>
                        {[1,2,3,4,5].map((s) => (
                          <option key={s} value={s}>{s} {'★'.repeat(s)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Typ pokoje</label>
                      <select value={aRoomType} onChange={(e) => setARoomType(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm">
                        {ROOM_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Cena za noc (Kč)</label>
                      <input type="number" step="1" min="0" required value={aPrice} onChange={(e) => setAPrice(e.target.value)}
                        placeholder="2500"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Počet nocí v balíčku</label>
                      <input type="number" min="1" value={aNights} onChange={(e) => setANights(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Check-in</label>
                      <input type="date" value={aCheckIn} onChange={(e) => setACheckIn(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Check-out</label>
                      <input type="date" value={aCheckOut} onChange={(e) => setACheckOut(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Odkaz na booking (affiliate / přímý)
                      </label>
                      <input type="url" value={aUrl} onChange={(e) => setAUrl(e.target.value)}
                        placeholder="https://www.booking.com/hotel/..."
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">Storno podmínky</label>
                      <input value={aCancel} onChange={(e) => setACancel(e.target.value)}
                        placeholder="Storno zdarma do 48 h před příjezdem"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="col-span-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={aBreakfast} onChange={(e) => setABreakfast(e.target.checked)} />
                        <span className="text-sm">Snídaně zahrnuta v ceně</span>
                      </label>
                    </div>
                  </div>
                  {err && <div className="text-sm text-red-600">{err}</div>}
                  <div className="flex gap-2">
                    <button type="submit" disabled={saving}
                      className="bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                      {saving ? 'Ukládám…' : 'Přidat ubytování'}
                    </button>
                    <button type="button" onClick={() => setShowAccomForm(false)}
                      className="px-4 py-2 border rounded-lg text-sm text-slate-600">
                      Zrušit
                    </button>
                  </div>
                </form>
              )}

              {accommodation.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <div className="text-4xl mb-3">🏨</div>
                  <div>Žádná ubytovací nabídka</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {accommodation.map((a) => (
                    <div key={a.id} className={`bg-white border rounded-xl p-4 ${!a.active ? 'opacity-60' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-900">🏨 {a.name}</span>
                            {a.stars && (
                              <span className="text-amber-500 text-sm">{stars(a.stars)}</span>
                            )}
                            {a.distance_meters && (
                              <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                                {a.distance_meters} m od akce
                              </span>
                            )}
                            {!a.active && (
                              <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Neaktivní</span>
                            )}
                          </div>
                          {a.description && <div className="text-sm text-slate-500 mt-0.5">{a.description}</div>}
                          {a.address && <div className="text-xs text-slate-400 mt-0.5">📍 {a.address}</div>}
                          <div className="flex gap-4 mt-1 text-sm flex-wrap">
                            <span className="font-semibold text-emerald-700">
                              {fmt(a.price_per_night_halire)}/noc × {a.base_nights} nocí = {fmt(a.price_per_night_halire * a.base_nights)}
                            </span>
                            <span className="text-slate-500 capitalize">{a.room_type}</span>
                            {a.breakfast_included && <span className="text-slate-500">🍳 snídaně</span>}
                          </div>
                          {a.cancellation_policy && (
                            <div className="text-xs text-slate-400 mt-0.5">Storno: {a.cancellation_policy}</div>
                          )}
                          {a.check_in_date && a.check_out_date && (
                            <div className="text-xs text-slate-400">
                              {a.check_in_date} → {a.check_out_date}
                            </div>
                          )}
                          {a.partner_url && (
                            <a href={a.partner_url} target="_blank" rel="noreferrer"
                              className="text-xs text-blue-600 hover:underline mt-0.5 inline-block">
                              Odkaz na booking →
                            </a>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => void toggleActive('accommodation', a.id, a.active)}
                            className={`text-xs px-3 py-1.5 rounded-lg border ${
                              a.active
                                ? 'text-slate-600 border-slate-300 hover:bg-slate-50'
                                : 'text-emerald-700 border-emerald-300 hover:bg-emerald-50'
                            }`}
                          >
                            {a.active ? 'Deaktivovat' : 'Aktivovat'}
                          </button>
                          <button
                            onClick={() => void deleteOffer('accommodation', a.id)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                          >
                            Smazat
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Info o API */}
      <div className="bg-slate-50 border rounded-xl p-4 text-sm text-slate-600 space-y-1">
        <div className="font-semibold text-slate-700">Integrace do checkoutu</div>
        <div>
          Nabídky se zobrazují zákazníkům automaticky na stránce checkout (krok „Dopravu & ubytování").
          Zákazník po nákupu obdrží potvrzovací kódy v e-mailu.
        </div>
        <div className="font-mono text-xs text-slate-500 mt-1">
          GET /api/events/{'{eventId}'}/travel-bundles · POST /api/checkout/bundle
        </div>
      </div>
    </div>
  );
}
