'use client';

import { FormEvent, useEffect, useState } from 'react';
import { TrendingUp, Plus } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface SubscriptionPackage {
  id: string;
  name: string;
  slug: string;
  seasonLabel: string;
  category: string;
  basePriceHalire: number;
  currency: string;
  status: string;
  saleStart: string;
  saleEnd: string | null;
  capacity: number | null;
  aboType: 'fixed' | 'choice';
  maxPicksForChoice: number | null;
  eventsCount: number;
  holdersCount: number;
  createdAt: string;
}

interface EventOption {
  id: string;
  title: string;
  dateStart: string;
}

function formatPrice(halire: number, currency: string): string {
  const kc = halire / 100;
  const symbol = currency === 'EUR' ? '€' : 'Kč';
  return `${kc.toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} ${symbol}`;
}

const CATEGORY_LABELS: Record<string, string> = {
  theater: 'Divadlo',
  concert_series: 'Koncertní cyklus',
  dance: 'Tanec / balet',
  children: 'Pro děti',
  other: 'Ostatní',
};

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Koncept', cls: 'bg-gray-100 text-gray-700' },
  on_sale: { label: 'V prodeji', cls: 'bg-emerald-100 text-emerald-800' },
  sold_out: { label: 'Vyprodáno', cls: 'bg-amber-100 text-amber-800' },
  closed: { label: 'Uzavřená', cls: 'bg-rose-100 text-rose-800' },
  archived: { label: 'Archiv', cls: 'bg-zinc-100 text-zinc-600' },
};

export default function SubscriptionsAdminPage() {
  const [packages, setPackages] = useState<SubscriptionPackage[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [seasonLabel, setSeasonLabel] = useState('2026/27');
  const [category, setCategory] = useState('theater');
  const [basePriceKc, setBasePriceKc] = useState('2500');
  const [capacity, setCapacity] = useState('');
  const [description, setDescription] = useState('');
  const [earlyBirdUntil, setEarlyBirdUntil] = useState('');
  const [earlyBirdPriceKc, setEarlyBirdPriceKc] = useState('');
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [aboType, setAboType] = useState<'fixed' | 'choice'>('fixed');
  const [maxPicks, setMaxPicks] = useState('4');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const data = await typedGet<{ packages: SubscriptionPackage[] }>(
        '/api/admin/subscriptions/packages',
      );
      setPackages(data.packages ?? []);
    } catch {
      // silent — auth issue se ukáže až při submit
    }
    try {
      const data = await typedGet<{ events: EventOption[] }>('/api/admin/events');
      setEvents(data.events ?? []);
    } catch {
      // ignore
    }
  }

  function toggleEvent(eventId: string) {
    setSelectedEventIds((prev) =>
      prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId],
    );
  }

  async function patchStatus(id: string, status: 'on_sale' | 'closed'): Promise<void> {
    setError(null);
    setSuccess(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const res = await fetch(`/api/admin/subscriptions/packages/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(
        status === 'on_sale' ? 'Abonentka spuštěna do prodeje.' : 'Abonentka uzavřena.',
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Síťová chyba');
    }
  }

  function activatePackage(id: string): Promise<void> {
    return patchStatus(id, 'on_sale');
  }

  function closePackage(id: string): Promise<void> {
    return patchStatus(id, 'closed');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      await typedPost<{ id: string; slug: string }>(
        '/api/admin/subscriptions/packages',
        {
          name,
          slug,
          seasonLabel,
          category,
          basePriceHalire: Math.round(Number(basePriceKc) * 100),
          description: description || undefined,
          capacity: capacity ? Number(capacity) : undefined,
          earlyBirdUntil: earlyBirdUntil ? new Date(earlyBirdUntil).toISOString() : undefined,
          earlyBirdPriceHalire: earlyBirdPriceKc
            ? Math.round(Number(earlyBirdPriceKc) * 100)
            : undefined,
          eventIds: selectedEventIds.length > 0 ? selectedEventIds : undefined,
          aboType,
          maxPicksForChoice: aboType === 'choice' ? Number(maxPicks) : undefined,
        },
        { throwOnError: true },
      );
      setSuccess(`Abonentka "${name}" vytvořena`);
      setName('');
      setSlug('');
      setDescription('');
      setEarlyBirdUntil('');
      setEarlyBirdPriceKc('');
      setSelectedEventIds([]);
      setShowForm(false);
      await load();
    } catch (err) {
      if (err instanceof TypedFetchError) {
        const body = err.body as { error?: string; message?: string } | undefined;
        setError(body?.message ?? body?.error ?? `HTTP ${err.status}`);
      } else {
        setError(err instanceof Error ? err.message : 'Síťová chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Abonentky"
        description="Sezónní permanentky pro divadlo / koncertní cyklus. Předplatitel má rezervované místo na X představení."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">{packages.length} balíčků celkem</p>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          {showForm ? 'Zavřít formulář' : 'Nová abonentka'}
        </Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>Nová abonentka</CardTitle>
            <CardDescription>
              Vyber představení co bude balíček pokrývat. Předplatitelé budou mít na všechny
              zarezervované místo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">Název</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Pondělní abonentka 2026/27"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Slug (URL)</label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  required
                  pattern="[a-z0-9-]{2,80}"
                  placeholder="pondelni-2026-27"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Sezóna</label>
                <Input
                  value={seasonLabel}
                  onChange={(e) => setSeasonLabel(e.target.value)}
                  required
                  placeholder="2026/27"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Kategorie</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="block w-full rounded-md border bg-card px-3 py-2 text-sm"
                >
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Cena (Kč)</label>
                <Input
                  type="number"
                  min={1}
                  value={basePriceKc}
                  onChange={(e) => setBasePriceKc(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Kapacita (volitelné)</label>
                <Input
                  type="number"
                  min={1}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="prázdné = neomezené"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Early bird do (volitelné)</label>
                <Input
                  type="datetime-local"
                  value={earlyBirdUntil}
                  onChange={(e) => setEarlyBirdUntil(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Early bird cena (Kč, volitelné)
                </label>
                <Input
                  type="number"
                  min={1}
                  value={earlyBirdPriceKc}
                  onChange={(e) => setEarlyBirdPriceKc(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">Popis (volitelné)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="block w-full rounded-md border bg-card px-3 py-2 text-sm"
                  placeholder="Popis abonentky pro buyer landing page..."
                />
              </div>
              <div className="md:col-span-2 rounded-md border bg-muted/30 p-3">
                <label className="mb-2 block text-xs font-medium uppercase">Typ abonementu</label>
                <div className="flex gap-2">
                  <label className={`flex flex-1 cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${aboType === 'fixed' ? 'border-primary bg-background' : 'opacity-70'}`}>
                    <input
                      type="radio"
                      name="aboType"
                      value="fixed"
                      checked={aboType === 'fixed'}
                      onChange={() => setAboType('fixed')}
                      className="mt-1"
                    />
                    <div>
                      <div className="font-medium">Festabo — pevný balíček</div>
                      <div className="text-xs text-muted-foreground">Předplatitel dostane vstupenku na všechna vybraná představení automaticky.</div>
                    </div>
                  </label>
                  <label className={`flex flex-1 cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${aboType === 'choice' ? 'border-primary bg-background' : 'opacity-70'}`}>
                    <input
                      type="radio"
                      name="aboType"
                      value="choice"
                      checked={aboType === 'choice'}
                      onChange={() => setAboType('choice')}
                      className="mt-1"
                    />
                    <div>
                      <div className="font-medium">Wahl-Abo — výběrový</div>
                      <div className="text-xs text-muted-foreground">Předplatitel si vybere X z N představení sám (Reservix model).</div>
                    </div>
                  </label>
                </div>
                {aboType === 'choice' ? (
                  <div className="mt-3">
                    <label className="mb-1 block text-xs font-medium">Kolik představení smí vybrat (max)</label>
                    <Input
                      type="number"
                      min={1}
                      max={selectedEventIds.length || undefined}
                      value={maxPicks}
                      onChange={(e) => setMaxPicks(e.target.value)}
                      required
                      className="max-w-[120px]"
                    />
                    {selectedEventIds.length > 0 && Number(maxPicks) > selectedEventIds.length ? (
                      <p className="mt-1 text-xs text-rose-700">
                        Max výběrů ({maxPicks}) nesmí být víc než počet představení v pool-u ({selectedEventIds.length}).
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">
                  Představení v balíčku ({selectedEventIds.length} vybráno)
                </label>
                <div className="max-h-60 overflow-y-auto rounded-md border bg-card p-3">
                  {events.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Žádné akce. Vytvoř nejdřív akce v sekci „Akce".
                    </p>
                  ) : (
                    events.map((ev) => (
                      <label
                        key={ev.id}
                        className="flex cursor-pointer items-center gap-2 py-1 text-sm hover:bg-muted/40"
                      >
                        <input
                          type="checkbox"
                          checked={selectedEventIds.includes(ev.id)}
                          onChange={() => toggleEvent(ev.id)}
                        />
                        <span className="flex-1">{ev.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(ev.dateStart).toLocaleDateString('cs-CZ')}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <div className="md:col-span-2">
                <Button type="submit" disabled={busy || !name || !slug}>
                  {busy ? 'Vytvářím…' : 'Vytvořit abonentku'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Seznam ({packages.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {packages.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <TrendingUp className="mb-2 h-10 w-10 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                Žádné abonentky. Vytvoř první sezónní balíček.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Název</th>
                  <th>Sezóna</th>
                  <th>Typ</th>
                  <th>Kategorie</th>
                  <th className="text-right">Cena</th>
                  <th className="text-right">Představení</th>
                  <th className="text-right">Předplatitelé</th>
                  <th>Stav</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => {
                  const status = STATUS_LABELS[p.status] ?? {
                    label: p.status,
                    cls: 'bg-gray-100 text-gray-700',
                  };
                  return (
                    <tr key={p.id} className="border-b hover:bg-muted/30">
                      <td className="py-2">
                        <div className="font-medium">{p.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{p.slug}</div>
                      </td>
                      <td>{p.seasonLabel}</td>
                      <td>
                        {p.aboType === 'choice' ? (
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-800">
                            Wahl {p.maxPicksForChoice}/{p.eventsCount}
                          </span>
                        ) : (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800">
                            Festabo
                          </span>
                        )}
                      </td>
                      <td>{CATEGORY_LABELS[p.category] ?? p.category}</td>
                      <td className="text-right tabular-nums">
                        {formatPrice(p.basePriceHalire, p.currency)}
                      </td>
                      <td className="text-right tabular-nums">{p.eventsCount}</td>
                      <td className="text-right tabular-nums">
                        {p.holdersCount}
                        {p.capacity ? (
                          <span className="text-xs text-muted-foreground"> / {p.capacity}</span>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="text-right">
                        {p.status === 'draft' ? (
                          <button
                            onClick={() => void activatePackage(p.id)}
                            className="rounded-md border px-2 py-1 text-xs hover:bg-muted/50"
                          >
                            Spustit prodej
                          </button>
                        ) : p.status === 'on_sale' ? (
                          <button
                            onClick={() => void closePackage(p.id)}
                            className="rounded-md border px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                          >
                            Uzavřít
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
