'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EventDetailNav } from '@/app/admin/events/[id]/EventDetailNav';

interface Forecast {
  id: string;
  computed_at: string;
  days_to_event: number;
  sold_pct: number;
  velocity_per_day: number;
  projected_final_pct: number | null;
  recommended_price_halire: number | null;
  price_change_reason: string | null;
  auto_applied: boolean;
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

export default function DemandForecastPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function loadForecast(): Promise<void> {
    setLoading(true);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/demand-forecast`);
      const d = (await r.json()) as { forecast?: Forecast };
      setForecast(d.forecast ?? null);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadForecast(); }, [eventId]);

  async function compute(): Promise<void> {
    setComputing(true);
    setError(null);
    setFeedback(null);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/demand-forecast`, { method: 'POST' });
      const d = (await r.json()) as { forecast?: Forecast; error?: string };
      if (!r.ok) { setError(d.error ?? `HTTP ${r.status}`); return; }
      setForecast(d.forecast ?? null);
      setFeedback('Forecast přepočítán.');
    } finally {
      setComputing(false);
    }
  }

  async function applyPrice(): Promise<void> {
    if (!forecast?.recommended_price_halire) return;
    setApplying(true);
    setError(null);
    try {
      const ttRes = await authFetch(`/api/admin/events/${eventId}/ticket-types`);
      const ttData = (await ttRes.json()) as { ticketTypes?: { id: string }[] };
      const types = ttData.ticketTypes ?? [];
      for (const tt of types) {
        await authFetch(`/api/admin/events/${eventId}/ticket-types/${tt.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ base_price: forecast.recommended_price_halire }),
        });
      }
      setFeedback(`Cena ${(forecast.recommended_price_halire / 100).toFixed(2)} Kč aplikována na ${types.length} typy vstupenek.`);
    } finally {
      setApplying(false);
    }
  }

  const fmtPct = (v: number | null) => (v != null ? `${Number(v).toFixed(1)} %` : '—');
  const fmtPrice = (v: number | null) => (v != null ? `${(Number(v) / 100).toFixed(2)} Kč` : '—');

  return (
    <div>
      <EventDetailNav eventId={eventId} />
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Demand Forecast</h1>
            <p className="text-sm text-muted-foreground">
              Projekce prodejnosti a doporučená cena na základě velocity prodeje.
            </p>
          </div>
          <Button onClick={() => void compute()} disabled={computing}>
            {computing ? 'Přepočítávám…' : '↻ Přepočítat'}
          </Button>
        </div>

        {error ? (
          <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
        ) : null}
        {feedback ? (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{feedback}</div>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Načítám…</p>
        ) : forecast ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle className="text-sm">Prodáno</CardTitle></CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{fmtPct(forecast.sold_pct)}</p>
                <p className="text-xs text-muted-foreground">ze všech kapacit</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Tempo prodeje</CardTitle></CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{Number(forecast.velocity_per_day).toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">vstupenek / den</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Projekce</CardTitle></CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{fmtPct(forecast.projected_final_pct)}</p>
                <p className="text-xs text-muted-foreground">za {forecast.days_to_event} dní do akce</p>
              </CardContent>
            </Card>
            <Card className="md:col-span-2 lg:col-span-3">
              <CardHeader><CardTitle className="text-sm">Doporučení ceny</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {forecast.recommended_price_halire ? (
                  <>
                    <p className="text-2xl font-bold">{fmtPrice(forecast.recommended_price_halire)}</p>
                    <p className="text-sm text-muted-foreground">{forecast.price_change_reason}</p>
                    <Button onClick={() => void applyPrice()} disabled={applying} variant="outline">
                      {applying ? 'Aplikuji…' : 'Aplikovat cenu na všechny typy'}
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Žádná změna ceny doporučena — prodejnost je v normálním rozsahu.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Vypočítáno: {new Date(forecast.computed_at).toLocaleString('cs-CZ')}
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Žádný forecast. Klikni na tlačítko Přepočítat pro první výpočet.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
