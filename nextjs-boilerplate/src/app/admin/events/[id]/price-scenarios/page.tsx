'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Plus, TrendingUp, TrendingDown, Calculator } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface TicketType {
  id: string;
  name: string;
  base_price: number;
}

interface Scenario {
  id: string;
  name: string;
  description: string | null;
  status: string;
  projected_revenue_halire: number | null;
  projected_sold_tickets: number | null;
  projected_conversion_pct: number | null;
  baseline_revenue_halire: number | null;
  baseline_sold_tickets: number | null;
  created_at: string;
}

interface Projection {
  revenueChange: number;
  revenueChangePct: number;
  soldChange: number;
  soldChangePct: number;
  conversionPct: number;
}

function fmt(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

export default function PriceScenariosPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [adjustments, setAdjustments] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ projection: Projection; baseline: { revenue: number; sold: number }; projected: { revenue: number; sold: number } } | null>(null);

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load(): Promise<void> {
    try {
      const [tt, sc] = await Promise.all([
        typedGet<{ ticketTypes: TicketType[] }>(`/api/admin/events/${eventId}/ticket-types`).catch(() => ({ ticketTypes: [] })),
        typedGet<{ scenarios: Scenario[] }>(`/api/admin/events/${eventId}/price-scenarios`),
      ]);
      setTicketTypes(tt.ticketTypes ?? []);
      setScenarios(sc.scenarios ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function setAdj(ttId: string, pct: number): void {
    setAdjustments((prev) => ({ ...prev, [ttId]: pct }));
  }

  async function model(): Promise<void> {
    setBusy(true);
    setError(null);
    setLastResult(null);
    try {
      const priceAdjustments: Record<string, { priceChangePct: number }> = {};
      for (const [ttId, pct] of Object.entries(adjustments)) {
        if (pct !== 0) priceAdjustments[ttId] = { priceChangePct: pct };
      }
      const res = await typedPost<{
        id: string;
        projection: Projection;
        baseline: { revenue: number; sold: number };
        projected: { revenue: number; sold: number };
      }>(
        `/api/admin/events/${eventId}/price-scenarios`,
        { name, description: description || undefined, priceAdjustments },
        { throwOnError: true },
      );
      setLastResult({ projection: res.projection, baseline: res.baseline, projected: res.projected });
      setName('');
      setDescription('');
      setAdjustments({});
      await load();
    } catch (err) {
      if (err instanceof TypedFetchError) {
        const body = err.body as { error?: string } | undefined;
        setError(body?.error ?? `HTTP ${err.status}`);
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
        title="Pricemaster — modelování cen"
        description="Nasimuluj cenové změny, porovnej projected revenue a vyber nejlepší strategii"
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-4 w-4" />
            Nový scénář
          </CardTitle>
          <CardDescription>
            Nastav procentní změny cen pro každý ticket type. Model spočítá projected revenue
            s elasticitou poptávky -1.2 (standard concert market).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Název scénáře</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="např. Agresivní +15 %"
              maxLength={200}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Popis (volitelně)</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="hypotéza co testuje"
              maxLength={1000}
            />
          </div>
          {ticketTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné ticket types pro tuto akci.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium">Procentní změny cen:</p>
              {ticketTypes.map((tt) => (
                <div key={tt.id} className="flex items-center gap-3 rounded-md border p-2">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{tt.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Současná cena: {fmt(tt.base_price)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      step="5"
                      min={-90}
                      max={500}
                      value={adjustments[tt.id] ?? 0}
                      onChange={(e) => setAdj(tt.id, Number(e.target.value))}
                      className="w-20 text-right"
                    />
                    <span className="text-sm">%</span>
                  </div>
                  <div className="w-24 text-right text-sm">
                    →{' '}
                    <span className="font-semibold">
                      {fmt(Math.round(tt.base_price * (1 + (adjustments[tt.id] ?? 0) / 100)))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Button onClick={model} disabled={busy || !name || ticketTypes.length === 0}>
            <Plus className="mr-1 h-4 w-4" />
            {busy ? 'Počítám…' : 'Modelovat'}
          </Button>
        </CardContent>
      </Card>

      {lastResult ? (
        <Card className="border-emerald-300 bg-emerald-50/30">
          <CardHeader>
            <CardTitle className="text-base">Projekce posledního scénáře</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Baseline tržby</p>
                <p className="text-lg font-bold">{fmt(lastResult.baseline.revenue)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Projected tržby</p>
                <p className="text-lg font-bold">{fmt(lastResult.projected.revenue)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Změna</p>
                <p className={`text-lg font-bold ${lastResult.projection.revenueChange >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {lastResult.projection.revenueChange >= 0 ? <TrendingUp className="inline h-4 w-4" /> : <TrendingDown className="inline h-4 w-4" />}
                  {' '}
                  {lastResult.projection.revenueChangePct.toFixed(1)} %
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Projected konverze</p>
                <p className="text-lg font-bold">{lastResult.projection.conversionPct.toFixed(1)} %</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Uložené scénáře ({scenarios.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {scenarios.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Žádné scénáře. Vytvoř první výše.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2">Název</th>
                  <th className="pb-2 text-right">Baseline</th>
                  <th className="pb-2 text-right">Projected</th>
                  <th className="pb-2 text-right">Δ %</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s) => {
                  const delta = s.projected_revenue_halire && s.baseline_revenue_halire && s.baseline_revenue_halire > 0
                    ? ((s.projected_revenue_halire - s.baseline_revenue_halire) / s.baseline_revenue_halire) * 100
                    : 0;
                  return (
                    <tr key={s.id} className="border-t">
                      <td className="py-2 font-medium">{s.name}</td>
                      <td className="py-2 text-right">{fmt(s.baseline_revenue_halire ?? 0)}</td>
                      <td className="py-2 text-right">{fmt(s.projected_revenue_halire ?? 0)}</td>
                      <td className={`py-2 text-right font-semibold ${delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {delta >= 0 ? '+' : ''}{delta.toFixed(1)} %
                      </td>
                      <td className="py-2">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{s.status}</span>
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
