'use client';

/**
 * /admin/events/[id]/demand-forecast
 *
 * Demand Forecasting & Yield Management pro promotéra.
 * Zobrazuje historii demand score + aktuální doporučení + yield rules.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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

interface ForecastEntry {
  id: string;
  computed_at: string;
  days_to_event: number;
  tickets_sold: number;
  tickets_total: number;
  pctSold: number;
  velocity7d: number | null;
  velocity1d: number | null;
  forecast_sold: number | null;
  forecastPct: number | null;
  demandScore: number | null;
  recommendation: string | null;
}

interface YieldRule {
  id: string;
  pct_threshold: number;
  action: string;
  price_delta_pct: number | null;
  notification_email: string | null;
  is_active: boolean;
  triggered_at: string | null;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  raise_price: 'Zdražit',
  lower_price: 'Zlevnit',
  flash_sale: 'Flash sale',
  notify: 'Notifikovat',
};

const RECOMMENDATION_CONFIG: Record<string, { label: string; color: string }> = {
  raise_price: { label: 'Doporučení: zdražit', color: 'bg-emerald-100 text-emerald-800' },
  lower_price: { label: 'Doporučení: zlevnit', color: 'bg-rose-100 text-rose-800' },
  flash_sale: { label: 'Doporučení: flash sale', color: 'bg-orange-100 text-orange-800' },
  last_minute: { label: 'Doporučení: last-minute akce', color: 'bg-red-100 text-red-800' },
  hold: { label: 'Doporučení: beze změny', color: 'bg-slate-100 text-slate-700' },
};

export default function DemandForecastPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [forecasts, setForecasts] = useState<ForecastEntry[]>([]);
  const [yieldRules, setYieldRules] = useState<YieldRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Rule form
  const [pctThreshold, setPctThreshold] = useState(80);
  const [action, setAction] = useState<'raise_price' | 'lower_price' | 'flash_sale' | 'notify'>('notify');
  const [priceDeltaPct, setPriceDeltaPct] = useState<number | null>(null);
  const [notifEmail, setNotifEmail] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch(`/api/admin/events/${eventId}/demand-forecast`);
        if (res.ok) {
          const j = (await res.json()) as { forecasts?: ForecastEntry[]; yieldRules?: YieldRule[] };
          setForecasts(j.forecasts ?? []);
          setYieldRules(j.yieldRules ?? []);
        } else {
          setError(`HTTP ${res.status}`);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [eventId]);

  const latest = forecasts[0];

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/demand-forecast`, {
        method: 'POST',
        body: JSON.stringify({
          pctThreshold,
          action,
          priceDeltaPct: action === 'raise_price' || action === 'lower_price' ? (priceDeltaPct ?? 10) : null,
          notificationEmail: action === 'notify' ? (notifEmail || null) : null,
          isActive: true,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback('Yield pravidlo přidáno.');
      // Reload
      const reloadRes = await authFetch(`/api/admin/events/${eventId}/demand-forecast`);
      if (reloadRes.ok) {
        const rj = (await reloadRes.json()) as { forecasts?: ForecastEntry[]; yieldRules?: YieldRule[] };
        setForecasts(rj.forecasts ?? []);
        setYieldRules(rj.yieldRules ?? []);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function scoreColor(score: number): string {
    if (score >= 70) return 'text-emerald-700';
    if (score >= 40) return 'text-amber-700';
    return 'text-rose-700';
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Načítám…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Demand Forecast & Yield Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Predikce poptávky na základě prodejní velocity. Nastav pravidla pro automatické doporučení cen.
        </p>
      </div>

      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}
      {feedback ? <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{feedback}</div> : null}

      {/* Aktuální stav */}
      {latest ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Prodáno</p>
              <p className="text-2xl font-bold">{latest.tickets_sold} / {latest.tickets_total}</p>
              <p className="text-sm text-muted-foreground">{latest.pctSold.toFixed(1)}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Velocity (7 dní / den)</p>
              <p className="text-2xl font-bold">{latest.velocity7d?.toFixed(1) ?? '—'}</p>
              <p className="text-sm text-muted-foreground">Včera: {latest.velocity1d ?? '—'} lístků</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Predikce do akce</p>
              <p className="text-2xl font-bold">{latest.forecast_sold ?? '—'} lístků</p>
              <p className="text-sm text-muted-foreground">{latest.forecastPct?.toFixed(1) ?? '—'}% obsazenost</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Demand score</p>
              <p className={`text-2xl font-bold ${latest.demandScore !== null ? scoreColor(latest.demandScore) : ''}`}>
                {latest.demandScore?.toFixed(0) ?? '—'} / 100
              </p>
              {latest.recommendation ? (
                <Badge className={`mt-1 text-xs ${RECOMMENDATION_CONFIG[latest.recommendation]?.color ?? 'bg-slate-100'}`}>
                  {RECOMMENDATION_CONFIG[latest.recommendation]?.label ?? latest.recommendation}
                </Badge>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Žádný forecast zatím. Data se přepočítávají každých 6 hodin automaticky.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Yield Rules */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Yield pravidla</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {yieldRules.length === 0 ? (
              <p className="text-sm text-muted-foreground">Žádná pravidla. Přidej pravidlo níže.</p>
            ) : (
              <div className="space-y-2">
                {yieldRules.map((rule) => (
                  <div key={rule.id} className={`rounded-md border p-3 text-sm ${rule.triggered_at ? 'border-emerald-300 bg-emerald-50' : 'bg-card'}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {rule.pct_threshold}% prodáno → {ACTION_LABELS[rule.action] ?? rule.action}
                        {rule.price_delta_pct ? ` o ${rule.price_delta_pct}%` : ''}
                        {rule.notification_email ? ` → ${rule.notification_email}` : ''}
                      </span>
                      {rule.triggered_at ? (
                        <Badge className="bg-emerald-100 text-emerald-800 text-xs">
                          Spuštěno {new Date(rule.triggered_at).toLocaleDateString('cs-CZ')}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">{rule.is_active ? 'Aktivní' : 'Vypnuto'}</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t pt-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Přidat pravidlo</p>
              <form onSubmit={(e) => void addRule(e)} className="space-y-3">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium whitespace-nowrap">Při</label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={pctThreshold}
                    onChange={(e) => setPctThreshold(Number(e.target.value) || 80)}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">% prodáno</span>
                </div>
                <div>
                  <select
                    value={action}
                    onChange={(e) => setAction(e.target.value as typeof action)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="notify">Notifikovat</option>
                    <option value="raise_price">Zdražit cenu</option>
                    <option value="lower_price">Zlevnit cenu</option>
                    <option value="flash_sale">Spustit Flash sale</option>
                  </select>
                </div>
                {(action === 'raise_price' || action === 'lower_price') ? (
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium whitespace-nowrap">O</label>
                    <Input
                      type="number"
                      min={1}
                      max={200}
                      value={priceDeltaPct ?? 10}
                      onChange={(e) => setPriceDeltaPct(Number(e.target.value) || 10)}
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                ) : null}
                {action === 'notify' ? (
                  <div>
                    <Input
                      type="email"
                      value={notifEmail}
                      onChange={(e) => setNotifEmail(e.target.value)}
                      placeholder="email@example.com (volitelný)"
                    />
                  </div>
                ) : null}
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting ? 'Ukládám…' : 'Přidat pravidlo'}
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>

        {/* Historie forecast */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Historie demand score (posledních 30)</CardTitle>
          </CardHeader>
          <CardContent>
            {forecasts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Žádná data.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="pb-2 text-left font-medium">Datum</th>
                      <th className="pb-2 text-left font-medium">Dní do akce</th>
                      <th className="pb-2 text-left font-medium">% prodáno</th>
                      <th className="pb-2 text-left font-medium">Vel. 7d/den</th>
                      <th className="pb-2 text-left font-medium">Score</th>
                      <th className="pb-2 text-left font-medium">Doporučení</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {forecasts.map((f) => (
                      <tr key={f.id}>
                        <td className="py-1.5 pr-3 text-muted-foreground">
                          {new Date(f.computed_at).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="py-1.5 pr-3">{f.days_to_event}</td>
                        <td className="py-1.5 pr-3">{f.pctSold.toFixed(1)}%</td>
                        <td className="py-1.5 pr-3">{f.velocity7d?.toFixed(1) ?? '—'}</td>
                        <td className={`py-1.5 pr-3 font-semibold ${f.demandScore !== null ? scoreColor(f.demandScore) : ''}`}>
                          {f.demandScore?.toFixed(0) ?? '—'}
                        </td>
                        <td className="py-1.5">
                          {f.recommendation ? (
                            <span className={`rounded px-1.5 py-0.5 text-xs ${RECOMMENDATION_CONFIG[f.recommendation]?.color ?? 'bg-slate-100'}`}>
                              {RECOMMENDATION_CONFIG[f.recommendation]?.label ?? f.recommendation}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
