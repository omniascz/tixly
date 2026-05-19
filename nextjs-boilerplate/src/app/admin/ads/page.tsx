'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, typedFetch, TypedFetchError } from '@/lib/typed-fetch';

interface Campaign {
  id: string;
  event_id: string;
  event_title: string;
  slot: string;
  category: string | null;
  status: string;
  cpc_halire: number;
  budget_halire: number;
  budget_remaining: number;
  impressions: number;
  clicks: number;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
}

interface Event {
  id: string;
  title: string;
}

const SLOTS = [
  { value: 'homepage_hero', label: 'Homepage hero (1× slot)' },
  { value: 'homepage_featured', label: 'Homepage featured (4× sloty)' },
  { value: 'category_top', label: 'Top kategorie' },
  { value: 'search_top', label: 'Top search results' },
];

function formatCzk(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

export default function AdsAdminPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [eventId, setEventId] = useState('');
  const [slot, setSlot] = useState('homepage_featured');
  const [category, setCategory] = useState('');
  const [cpcKc, setCpcKc] = useState('5');
  const [budgetKc, setBudgetKc] = useState('500');

  useEffect(() => {
    void load();
  }, []);

  async function load(): Promise<void> {
    try {
      const [cData, eData] = await Promise.all([
        typedGet<{ campaigns: Campaign[] }>('/api/admin/ads/campaigns'),
        typedGet<{ events?: Event[] }>('/api/admin/events'),
      ]);
      setCampaigns(cData.campaigns ?? []);
      setEvents(eData.events ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function createCampaign(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await typedPost('/api/admin/ads/campaigns', {
        eventId,
        slot,
        category: category.trim() || undefined,
        cpcHalire: Math.round(Number(cpcKc) * 100),
        budgetHalire: Math.round(Number(budgetKc) * 100),
      }, { throwOnError: true });
      setShowForm(false);
      setEventId('');
      setCategory('');
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

  async function patchCampaign(id: string, body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await typedFetch(`/api/admin/ads/campaigns/${id}`, {
        method: 'PATCH',
        body,
        throwOnError: true,
      });
      await load();
    } catch (err) {
      if (err instanceof TypedFetchError) {
        const errBody = err.body as { error?: string } | undefined;
        setError(errBody?.error ?? `HTTP ${err.status}`);
      } else {
        setError(err instanceof Error ? err.message : 'Síťová chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Marketplace Ads"
        description="Sponzorovaná místa na homepage, v kategoriích a search results. CPC model."
      />

      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">
          {campaigns.length} kampaní celkem
        </p>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Zavřít' : '+ Nová kampaň'}
        </Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>Nová kampaň</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Akce</label>
              <select
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— Vyber akci —</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Slot</label>
              <select
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {SLOTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            {(slot === 'category_top' || slot === 'search_top') ? (
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Kategorie / keyword
                </label>
                <Input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="koncert, divadlo, festival… (volitelné)"
                  maxLength={80}
                />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">CPC (Kč/klik)</label>
                <Input
                  type="number"
                  step="0.5"
                  min={1}
                  max={1000}
                  value={cpcKc}
                  onChange={(e) => setCpcKc(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Budget (Kč)</label>
                <Input
                  type="number"
                  step="100"
                  min={100}
                  max={100000}
                  value={budgetKc}
                  onChange={(e) => setBudgetKc(e.target.value)}
                />
              </div>
            </div>
            <Button onClick={createCampaign} disabled={busy || !eventId}>
              {busy ? 'Vytvářím…' : 'Vytvořit kampaň'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Žádné kampaně. Vytvoř první přes „+ Nová kampaň".
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Akce</th>
                <th className="px-3 py-2">Slot</th>
                <th className="px-3 py-2 text-right">CPC</th>
                <th className="px-3 py-2 text-right">Budget</th>
                <th className="px-3 py-2 text-right">Imprese</th>
                <th className="px-3 py-2 text-right">Kliky</th>
                <th className="px-3 py-2">Stav</th>
                <th className="px-3 py-2">Akce</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{c.event_title}</td>
                  <td className="px-3 py-2 text-xs">{c.slot}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCzk(c.cpc_halire)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCzk(c.budget_remaining)} / {formatCzk(c.budget_halire)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.impressions}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.clicks}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        c.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800'
                          : c.status === 'paused'
                            ? 'bg-amber-100 text-amber-800'
                            : c.status === 'depleted'
                              ? 'bg-slate-100 text-slate-800'
                              : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 space-x-1">
                    {c.status === 'active' ? (
                      <button
                        onClick={() => patchCampaign(c.id, { status: 'paused' })}
                        className="text-xs text-amber-700 hover:underline"
                      >
                        Pauza
                      </button>
                    ) : c.status === 'paused' ? (
                      <button
                        onClick={() => patchCampaign(c.id, { status: 'active' })}
                        className="text-xs text-emerald-700 hover:underline"
                      >
                        Spustit
                      </button>
                    ) : c.status === 'depleted' ? (
                      <button
                        onClick={() => patchCampaign(c.id, { budgetTopUpHalire: 50000 })}
                        className="text-xs text-blue-700 hover:underline"
                      >
                        +500 Kč
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
