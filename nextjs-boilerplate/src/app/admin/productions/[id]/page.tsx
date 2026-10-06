'use client';

/**
 * Kolo 8 / krok 1 — karta inscenace a její termíny.
 * Karta se zadává jednou; nový termín = vybrat město a sál, datum a čas, ceník převzít z předchozího termínu.
 */
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Card {
  id: string; title: string; subtitle: string | null; description: string | null; author: string | null; director: string | null;
  cast: Array<{ role: string; name: string }>; durationMin: number | null; intermissionMin: number | null; ageRating: string | null;
  genre: string | null; photos: string[]; videoUrl: string | null;
}
interface Term {
  id: string; dateStart: string; status: string; termNote: string | null; castAlternation: string | null;
  venueId: string; venueName: string; city: string; capacity: number; sold: number;
}
interface Venue { id: string; name: string; city: string; capacity: number; zones?: Array<{ id: string; name: string; color: string }> }

const api = (url: string, init?: RequestInit) =>
  fetch(url, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });

const STATUS: Record<string, string> = { published: 'V prodeji', pending_review: 'Ke schválení', draft: 'Koncept', cancelled: 'Zrušeno' };

export default function ProductionDetailPage({ params }: { params: { id: string } }) {
  const [card, setCard] = useState<Card | null>(null);
  const [terms, setTerms] = useState<Term[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [castText, setCastText] = useState('');
  const [photosText, setPhotosText] = useState('');
  // nový termín
  const [city, setCity] = useState('');
  const [venueId, setVenueId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('19:00');
  const [copyFrom, setCopyFrom] = useState('');
  const [termNote, setTermNote] = useState('');
  const [alternation, setAlternation] = useState('');
  const [busy, setBusy] = useState(false);
  // Kolo 8 / krok 2: ceny podle cenových zón plánku sálu (první termín bez předlohy ceníku)
  const [zonePrice, setZonePrice] = useState<Record<string, string>>({});

  async function load() {
    const r = await api(`/api/admin/productions/${params.id}`);
    if (!r.ok) { setErr(`Inscenaci nelze načíst (HTTP ${r.status}).`); return; }
    const j = (await r.json()) as { production: Card; terms: Term[] };
    setCard(j.production);
    setTerms(j.terms);
    setCastText(j.production.cast.map((c) => `${c.role}: ${c.name}`).join('\n'));
    setPhotosText(j.production.photos.join('\n'));
    if (!copyFrom && j.terms.length > 0) setCopyFrom(j.terms[j.terms.length - 1].id);
  }
  useEffect(() => {
    void load();
    void (async () => {
      // Knihovna míst (místo → sály se zónami) + starší sály mimo knihovnu.
      const [lib, legacy] = await Promise.all([api('/api/admin/venue-places'), api('/api/admin/venues')]);
      const fromLib: Venue[] = lib.ok
        ? ((await lib.json()) as { places: Array<{ city: string; halls: Array<{ id: string; name: string; capacity: number; zones: Venue['zones'] }> }> }).places
            .flatMap((pl) => pl.halls.map((h) => ({ id: h.id, name: h.name, city: pl.city, capacity: h.capacity, zones: h.zones })))
        : [];
      const rest: Venue[] = legacy.ok ? ((await legacy.json()) as { venues: Venue[] }).venues.filter((v) => !fromLib.some((x) => x.id === v.id)) : [];
      setVenues([...fromLib, ...rest]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const cities = useMemo(() => [...new Set(venues.map((v) => v.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs')), [venues]);
  const hallsInCity = venues.filter((v) => v.city === city);
  const hallZones = venues.find((v) => v.id === venueId)?.zones ?? [];
  const zonePricesReady = hallZones.length > 0 && hallZones.every((z) => /^\d+([.,]\d{1,2})?$/.test((zonePrice[z.name] ?? '').trim()));

  async function saveCard() {
    if (!card) return;
    setErr(null); setMsg(null);
    const cast = castText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const i = l.indexOf(':');
      return i >= 0 ? { role: l.slice(0, i).trim(), name: l.slice(i + 1).trim() } : { role: '', name: l };
    });
    const photos = photosText.split('\n').map((l) => l.trim()).filter(Boolean);
    const r = await api(`/api/admin/productions/${params.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: card.title, subtitle: card.subtitle || null, description: card.description || null, author: card.author || null,
        director: card.director || null, cast, durationMin: card.durationMin || null, intermissionMin: card.intermissionMin ?? null,
        ageRating: card.ageRating || null, genre: card.genre || null, photos, videoUrl: card.videoUrl || null,
      }),
    });
    if (!r.ok) { setErr(`Uložení selhalo: ${JSON.stringify((await r.json().catch(() => ({}))))}`); return; }
    setMsg('Karta uložena — termíny ji přebírají.');
    await load();
  }

  async function createTerm() {
    setErr(null); setMsg(null); setBusy(true);
    try {
      const offset = -new Date(`${date}T${time}:00`).getTimezoneOffset();
      const sign = offset >= 0 ? '+' : '-';
      const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
      const mm = String(Math.abs(offset) % 60).padStart(2, '0');
      const r = await api(`/api/admin/productions/${params.id}/terms`, {
        method: 'POST',
        body: JSON.stringify({
          venueId, dateStart: `${date}T${time}:00${sign}${hh}:${mm}`, copyPricingFromEventId: copyFrom || null,
          zonePrices: copyFrom ? undefined : hallZones.map((z) => ({
            zone: z.name, priceHalire: Math.round(Number((zonePrice[z.name] ?? '0').replace(',', '.')) * 100), vatRateCode: 'CZ_REDUCED',
          })),
          termNote: termNote || null, castAlternation: alternation || null,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { status?: string; seats?: number; message?: string; error?: string };
      if (!r.ok) { setErr(j.message ?? j.error ?? `HTTP ${r.status}`); return; }
      setMsg(j.status === 'published' ? `Termín založen a je v prodeji (${j.seats} míst).` : `Termín založen, čeká na schválení (${j.seats} míst).`);
      setTermNote(''); setAlternation('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (err && !card) return <p className="text-sm text-rose-700">{err}</p>;
  if (!card) return <p className="text-sm text-muted-foreground">Načítám…</p>;
  const set = (k: keyof Card) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setCard({ ...card, [k]: ['durationMin', 'intermissionMin'].includes(k) ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value });

  return (
    <div className="space-y-6">
      <PageHeader title={card.title} description="Karta inscenace a termíny" />
      {msg ? <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800" data-testid="production-msg">{msg}</p> : null}
      {err ? <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800">{err}</p> : null}

      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="font-semibold">Karta inscenace</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">Název<Input value={card.title} onChange={set('title')} /></label>
          <label className="text-sm">Podtitul<Input value={card.subtitle ?? ''} onChange={set('subtitle')} /></label>
          <label className="text-sm">Autor<Input value={card.author ?? ''} onChange={set('author')} /></label>
          <label className="text-sm">Režie<Input value={card.director ?? ''} onChange={set('director')} /></label>
          <label className="text-sm">Délka (min)<Input type="number" value={card.durationMin ?? ''} onChange={set('durationMin')} /></label>
          <label className="text-sm">Přestávka (min)<Input type="number" value={card.intermissionMin ?? ''} onChange={set('intermissionMin')} /></label>
          <label className="text-sm">Věková přístupnost<Input value={card.ageRating ?? ''} onChange={set('ageRating')} placeholder="např. 12+" /></label>
          <label className="text-sm">Žánr<Input value={card.genre ?? ''} onChange={set('genre')} /></label>
          <label className="text-sm md:col-span-2">Video (odkaz)<Input value={card.videoUrl ?? ''} onChange={set('videoUrl')} /></label>
        </div>
        <label className="block text-sm">Popis
          <textarea className="mt-1 h-28 w-full rounded-md border bg-background p-2 text-sm" value={card.description ?? ''} onChange={set('description')} />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">Obsazení (řádek „role: jméno")
            <textarea className="mt-1 h-28 w-full rounded-md border bg-background p-2 text-sm" value={castText} onChange={(e) => setCastText(e.target.value)} />
          </label>
          <label className="block text-sm">Fotky (jeden odkaz na řádek)
            <textarea className="mt-1 h-28 w-full rounded-md border bg-background p-2 text-sm" value={photosText} onChange={(e) => setPhotosText(e.target.value)} />
          </label>
        </div>
        <Button onClick={() => void saveCard()}>Uložit kartu</Button>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-4" data-testid="new-term">
        <h2 className="font-semibold">Nový termín</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">Město
            <select className="mt-1 block w-full rounded-md border bg-background p-2" value={city} onChange={(e) => { setCity(e.target.value); setVenueId(''); }} data-testid="term-city">
              <option value="">— vyberte —</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-sm">Sál
            <select className="mt-1 block w-full rounded-md border bg-background p-2" value={venueId} onChange={(e) => setVenueId(e.target.value)} disabled={!city} data-testid="term-venue">
              <option value="">— vyberte —</option>
              {hallsInCity.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.capacity} míst)</option>)}
            </select>
          </label>
          <label className="text-sm">Ceník převzít z
            <select className="mt-1 block w-full rounded-md border bg-background p-2" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} data-testid="term-copy">
              <option value="">— žádný (zadat později) —</option>
              {terms.map((t) => <option key={t.id} value={t.id}>{new Date(t.dateStart).toLocaleString('cs-CZ')} · {t.city} · {t.venueName}</option>)}
            </select>
          </label>
          <label className="text-sm">Datum<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="term-date" /></label>
          <label className="text-sm">Čas<Input type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="term-time" /></label>
          <label className="text-sm">Poznámka k termínu<Input value={termNote} onChange={(e) => setTermNote(e.target.value)} /></label>
          <label className="text-sm md:col-span-3">Alternace obsazení<Input value={alternation} onChange={(e) => setAlternation(e.target.value)} placeholder="např. Nina: Lucie Bílá" /></label>
        </div>
        {!copyFrom && hallZones.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-3" data-testid="zone-prices">
            {hallZones.map((z) => (
              <label key={z.id} className="text-sm">
                <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full" style={{ background: z.color }} />{z.name} — cena (Kč, DPH 12 %)</span>
                <Input value={zonePrice[z.name] ?? ''} onChange={(e) => setZonePrice({ ...zonePrice, [z.name]: e.target.value })} inputMode="decimal" />
              </label>
            ))}
          </div>
        ) : null}
        <Button onClick={() => void createTerm()} disabled={busy || !venueId || !date || (!copyFrom && !zonePricesReady)} data-testid="term-create">
          {busy ? 'Zakládám…' : 'Založit termín'}
        </Button>
        {!copyFrom && venueId && hallZones.length === 0 ? <p className="text-xs text-muted-foreground">Sál nemá cenové zóny — doplňte je v editoru plánku, nebo převezměte ceník z předchozího termínu.</p> : null}
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 font-semibold">Termíny ({terms.length})</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1">Datum</th><th>Město</th><th>Sál</th><th>Obsazenost</th><th>Stav</th><th /></tr></thead>
          <tbody>
            {terms.map((t) => (
              <tr key={t.id} className="border-t" data-testid="term-row">
                <td className="py-1">{new Date(t.dateStart).toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                <td>{t.city}</td>
                <td>{t.venueName}</td>
                <td>{t.sold} / {t.capacity}</td>
                <td>{STATUS[t.status] ?? t.status}</td>
                <td><a className="text-primary underline" href={`/admin/events/${t.id}`}>Upravit</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
