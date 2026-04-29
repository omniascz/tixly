'use client';

import { FormEvent, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';
import { formatMoney } from '@/lib/format';

interface Suggestion {
  suggestedPriceMinor: number;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  comparablesCount: number;
  medianPriceMinor: number;
  p25PriceMinor: number;
  p75PriceMinor: number;
  avgSellThroughPct: number;
  examples: { eventTitle: string; basePrice: number; sellThrough: number; date: string }[];
}

const CATEGORIES = [
  'concert',
  'festival',
  'theatre',
  'club_party',
  'sports',
  'conference',
  'workshop',
  'family',
  'comedy',
  'other',
];

interface Venue {
  id: string;
  name: string;
}

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

export default function PriceSuggestionPage() {
  const [category, setCategory] = useState('concert');
  const [venueId, setVenueId] = useState('');
  const [estimatedCapacity, setEstimatedCapacity] = useState('500');
  const [venues, setVenues] = useState<Venue[]>([]);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load available venues
  useState(() => {
    void (async () => {
      const res = await authFetch('/api/admin/venues');
      if (res.ok) {
        const j = (await res.json()) as { venues?: Venue[] };
        setVenues(j.venues ?? []);
      }
    })();
  });

  async function generate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuggestion(null);
    try {
      const res = await authFetch('/api/admin/ai/price-suggestion', {
        method: 'POST',
        body: JSON.stringify({
          category,
          venueId: venueId || null,
          estimatedCapacity: Number(estimatedCapacity),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        suggestion?: Suggestion;
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuggestion(j.suggestion ?? null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="💡 AI price suggestion"
        description="Doporučená base price na základě analýzy podobných minulých akcí. Median, p25/p75, sell-through."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Parametry</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={generate} className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Kategorie</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Sál (volitelné)</label>
              <select
                value={venueId}
                onChange={(e) => setVenueId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— libovolný —</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Odhadovaná kapacita
              </label>
              <Input
                type="number"
                min={1}
                value={estimatedCapacity}
                onChange={(e) => setEstimatedCapacity(e.target.value)}
                required
              />
            </div>
            <div className="md:col-span-3">
              <Button type="submit" disabled={busy}>
                {busy ? 'Analyzuji…' : '🔍 Analyzovat'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {suggestion ? (
        <>
          <Card
            className={
              suggestion.confidence === 'high'
                ? 'border-emerald-300 bg-emerald-50/30'
                : suggestion.confidence === 'medium'
                  ? 'border-amber-300 bg-amber-50/30'
                  : 'border-slate-300 bg-slate-50/30'
            }
          >
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Doporučená cena</span>
                <ConfidenceBadge level={suggestion.confidence} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-5xl font-bold tabular-nums">
                {formatMoney(suggestion.suggestedPriceMinor, 'CZK')}
              </div>
              <p className="text-sm">{suggestion.reasoning}</p>
              <div className="grid grid-cols-2 gap-3 rounded-md bg-white/60 p-3 md:grid-cols-4">
                <Stat
                  label="Median"
                  value={formatMoney(suggestion.medianPriceMinor, 'CZK')}
                />
                <Stat label="p25" value={formatMoney(suggestion.p25PriceMinor, 'CZK')} />
                <Stat label="p75" value={formatMoney(suggestion.p75PriceMinor, 'CZK')} />
                <Stat
                  label="Avg sell-through"
                  value={`${suggestion.avgSellThroughPct}%`}
                  sub={`${suggestion.comparablesCount} podobných akcí`}
                />
              </div>
              <Button
                onClick={() =>
                  navigator.clipboard.writeText(
                    String(suggestion.suggestedPriceMinor / 100),
                  )
                }
                size="sm"
                variant="outline"
              >
                📋 Kopírovat cenu
              </Button>
            </CardContent>
          </Card>

          {suggestion.examples.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Examples ({suggestion.examples.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2">Akce</th>
                      <th className="text-right">Base price</th>
                      <th className="text-right">Sell-through</th>
                      <th>Datum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestion.examples.map((e, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-2">{e.eventTitle}</td>
                        <td className="text-right tabular-nums">
                          {formatMoney(e.basePrice, 'CZK')}
                        </td>
                        <td className="text-right tabular-nums">
                          <span
                            className={
                              e.sellThrough >= 80
                                ? 'rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800'
                                : e.sellThrough >= 50
                                  ? 'rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800'
                                  : 'rounded bg-rose-100 px-1.5 py-0.5 text-xs text-rose-800'
                            }
                          >
                            {e.sellThrough}%
                          </span>
                        </td>
                        <td className="text-xs text-muted-foreground">
                          {new Date(e.date).toLocaleDateString('cs-CZ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ConfidenceBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const map = {
    high: 'bg-emerald-100 text-emerald-800',
    medium: 'bg-amber-100 text-amber-800',
    low: 'bg-slate-100 text-slate-700',
  };
  const label = { high: 'Vysoká', medium: 'Střední', low: 'Nízká' }[level];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[level]}`}>
      {label} confidence
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
