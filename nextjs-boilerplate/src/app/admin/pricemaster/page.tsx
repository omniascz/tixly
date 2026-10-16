'use client';

import { useEffect, useState, type JSX } from 'react';
import Link from 'next/link';
import { TrendingUp, TrendingDown, BarChart3, FlaskConical, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { typedGet } from '@/lib/typed-fetch';

interface TicketTypeRow {
  ticket_type_id: string;
  ticket_type_name: string;
  event_title: string;
  event_id: string;
  base_price: number;
  avg_elasticity: number | null;
  sample_count: number;
  total_price_changes: number;
}

interface ElasticitySummary {
  meanElasticity: number | null;
  sampleSize: number;
  interpretation: string;
}

function fmtKc(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

export default function PricemasterPage(): JSX.Element {
  const [data, setData] = useState<{ ticketTypes: TicketTypeRow[]; summary: ElasticitySummary } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    typedGet<{ ticketTypes: TicketTypeRow[]; summary: ElasticitySummary }>('/api/admin/pricing-elasticity')
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Chyba'));
  }, []);

  // Render PageHeader vždy (lepší UX + e2e testability), data section pak conditional
  if (error || !data) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader
          title="Pricemaster"
          description="TM-style cenová analytika — pozorovaná elasticita, A/B testy, history price changes"
        />
        {error ? (
          <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
        ) : (
          <div className="text-sm text-muted-foreground">Načítám…</div>
        )}
      </div>
    );
  }

  function elasticityLabel(e: number | null): { color: string; label: string } {
    if (e === null) return { color: 'bg-slate-100 text-slate-700', label: '—' };
    if (e < -1.5) return { color: 'bg-emerald-100 text-emerald-800', label: 'Elastický (snížit cenu)' };
    if (e < -0.5) return { color: 'bg-blue-100 text-blue-800', label: 'Středně elastický' };
    if (e < 0) return { color: 'bg-amber-100 text-amber-800', label: 'Mírně elastický' };
    return { color: 'bg-rose-100 text-rose-800', label: 'Inelastický (zvyš cenu)' };
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Pricemaster"
        description="TM-style cenová analytika — pozorovaná elasticita, A/B testy, history price changes"
      />

      {/* Summary card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Tržní citlivost (posledních 90 dní)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold tabular-nums">
                {data.summary.meanElasticity !== null
                  ? data.summary.meanElasticity.toFixed(2)
                  : '—'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Mean observed elasticity ({data.summary.sampleSize} vzorků)
              </p>
            </div>
            <div className="max-w-md rounded-md bg-muted p-3 text-sm">
              <AlertCircle className="mb-1 inline h-4 w-4" /> {data.summary.interpretation}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per ticket-type table */}
      <Card>
        <CardHeader>
          <CardTitle>Ticket types ({data.ticketTypes.length})</CardTitle>
          <CardDescription>
            Klikni na ticket type pro detail price scenarios. Elasticita se počítá z historie změn cen
            (alespoň 1 cenová změna potřebná pro vzorek).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.ticketTypes.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Žádná data.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-2">Akce / typ</th>
                    <th className="pb-2 text-right">Cena</th>
                    <th className="pb-2 text-right">Elasticita</th>
                    <th className="pb-2 text-right">Vzorky</th>
                    <th className="pb-2 text-right">Změn cen</th>
                    <th className="pb-2">Interpretace</th>
                    <th className="pb-2">Akce</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ticketTypes.map((tt) => {
                    const lbl = elasticityLabel(tt.avg_elasticity);
                    return (
                      <tr key={tt.ticket_type_id} className="border-t">
                        <td className="py-2">
                          <p className="font-medium">{tt.event_title}</p>
                          <p className="text-xs text-muted-foreground">{tt.ticket_type_name}</p>
                        </td>
                        <td className="py-2 text-right tabular-nums">{fmtKc(tt.base_price)}</td>
                        <td className="py-2 text-right font-mono">
                          {tt.avg_elasticity !== null ? (
                            <span className="inline-flex items-center gap-1">
                              {tt.avg_elasticity < -1 ? (
                                <TrendingDown className="h-3 w-3 text-emerald-600" />
                              ) : tt.avg_elasticity > 0 ? (
                                <TrendingUp className="h-3 w-3 text-rose-600" />
                              ) : null}
                              {Number(tt.avg_elasticity).toFixed(2)}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="py-2 text-right tabular-nums">{tt.sample_count}</td>
                        <td className="py-2 text-right tabular-nums">{tt.total_price_changes}</td>
                        <td className="py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${lbl.color}`}>
                            {lbl.label}
                          </span>
                        </td>
                        <td className="py-2">
                          <Link
                            href={`/admin/events/${tt.event_id}/price-scenarios`}
                            className="text-xs text-blue-700 hover:underline"
                          >
                            Modelovat
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick links */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Link href="/admin/ab-price-tests" className="block">
          <Card className="transition hover:bg-muted/30">
            <CardContent className="flex items-center gap-3 pt-6">
              <FlaskConical className="h-8 w-8 text-purple-600" />
              <div>
                <p className="font-semibold">A/B testy cen</p>
                <p className="text-xs text-muted-foreground">Split traffic mezi 2 cenami</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/ads" className="block">
          <Card className="transition hover:bg-muted/30">
            <CardContent className="flex items-center gap-3 pt-6">
              <BarChart3 className="h-8 w-8 text-emerald-600" />
              <div>
                <p className="font-semibold">Marketplace Ads</p>
                <p className="text-xs text-muted-foreground">CPC bidding + cross-promo</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/dashboard/live" className="block">
          <Card className="transition hover:bg-muted/30">
            <CardContent className="flex items-center gap-3 pt-6">
              <TrendingUp className="h-8 w-8 text-blue-600" />
              <div>
                <p className="font-semibold">Live prodej</p>
                <p className="text-xs text-muted-foreground">Real-time stream</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
