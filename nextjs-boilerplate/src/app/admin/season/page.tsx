'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';
import { TrendingUp, AlertTriangle } from 'lucide-react';

interface EventRow {
  id: string;
  title: string;
  dateStart: string;
  venueName: string | null;
  totalCapacity: number;
  soldQty: number;
  occupancyPct: number;
  grossRevenueHalire: number;
  refundedHalire: number;
  ordersCount: number;
  daysToEvent: number;
}

interface Summary {
  totalEvents: number;
  totalGrossHalire: number;
  totalRefundedHalire: number;
  totalNetHalire: number;
  totalSold: number;
  totalCapacity: number;
  overallOccupancyPct: number;
}

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

function formatCzk(halire: number): string {
  return `${Math.round(halire / 100).toLocaleString('cs-CZ')} Kč`;
}

function occupancyColor(pct: number): string {
  if (pct >= 90) return 'bg-rose-500';
  if (pct >= 70) return 'bg-amber-500';
  if (pct >= 40) return 'bg-emerald-500';
  return 'bg-slate-400';
}

export default function SeasonPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await authFetch(`/api/admin/season?${params.toString()}`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { events: EventRow[]; summary: Summary };
      setEvents(data.events ?? []);
      setSummary(data.summary);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sezónní přehled"
        description="Všechna představení v jedné tabulce. Obsazenost, tržby, dnů do akce."
      />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium">Od</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Do</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button onClick={load} disabled={busy} size="sm">
          {busy ? 'Načítám…' : 'Aplikovat'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Default: posledních 30 dní + nadcházejících 90 dní
        </p>
      </div>

      {summary ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs uppercase text-muted-foreground">Představení</p>
              <p className="mt-1 text-2xl font-bold">{summary.totalEvents}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs uppercase text-muted-foreground">Prodáno lístků</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {summary.totalSold.toLocaleString('cs-CZ')}
              </p>
              <p className="text-xs text-muted-foreground">
                z {summary.totalCapacity.toLocaleString('cs-CZ')}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs uppercase text-muted-foreground">Obsazenost</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {summary.overallOccupancyPct}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs uppercase text-muted-foreground">Hrubé tržby</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {formatCzk(summary.totalGrossHalire)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs uppercase text-muted-foreground">Po refundech</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
                {formatCzk(summary.totalNetHalire)}
              </p>
              {summary.totalRefundedHalire > 0 ? (
                <p className="text-xs text-rose-700">
                  − {formatCzk(summary.totalRefundedHalire)}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Představení ({events.length})</CardTitle>
          <CardDescription>Klikni na řádek pro detailní sales report.</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
              <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden /> {error}
            </div>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {busy ? 'Načítám…' : 'V tomto období žádná představení.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Datum</th>
                  <th>Představení</th>
                  <th>Sál</th>
                  <th className="text-center">Obsazenost</th>
                  <th className="text-right">Prodáno</th>
                  <th className="text-right">Tržby</th>
                  <th className="text-right">Dní do</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b hover:bg-muted/30">
                    <td className="py-2 text-xs">
                      <Link
                        href={`/admin/events/${e.id}/sales-report`}
                        className="text-primary hover:underline"
                      >
                        {new Date(e.dateStart).toLocaleDateString('cs-CZ', {
                          day: 'numeric',
                          month: 'numeric',
                          year: 'numeric',
                        })}
                      </Link>
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(e.dateStart).toLocaleTimeString('cs-CZ', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </td>
                    <td className="font-medium">{e.title}</td>
                    <td className="text-xs text-muted-foreground">{e.venueName ?? '—'}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded bg-muted">
                          <div
                            className={`h-full ${occupancyColor(e.occupancyPct)}`}
                            style={{ width: `${e.occupancyPct}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-xs tabular-nums">
                          {e.occupancyPct}%
                        </span>
                      </div>
                    </td>
                    <td className="text-right tabular-nums">
                      {e.soldQty}/{e.totalCapacity}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatCzk(e.grossRevenueHalire)}
                      {e.refundedHalire > 0 ? (
                        <span className="block text-xs text-rose-700">
                          − {formatCzk(e.refundedHalire)}
                        </span>
                      ) : null}
                    </td>
                    <td className="text-right text-xs">
                      {e.daysToEvent > 0 ? (
                        <span className="text-muted-foreground">{e.daysToEvent} d</span>
                      ) : e.daysToEvent === 0 ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-900">
                          dnes
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {Math.abs(e.daysToEvent)} d zpět
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" aria-hidden /> Co s tímhle dělat
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            • <strong>Obsazenost &lt; 40 %</strong> + akce do 14 dní → pošli{' '}
            <Link href="/admin/broadcasts" className="text-primary hover:underline">
              newsletter
            </Link>{' '}
            nebo vytvoř{' '}
            <Link href="/admin/promo-codes" className="text-primary hover:underline">
              promo kód
            </Link>
            .
          </p>
          <p>
            • <strong>Obsazenost ≥ 90 %</strong> → zvážit přidání druhého představení
            (otevřít{' '}
            <Link href="/admin/events/batch-import" className="text-primary hover:underline">
              hromadný import
            </Link>
            ).
          </p>
          <p>
            • <strong>Sezónní permanentky</strong> → zobrazit v profilu pořadatele{' '}
            (
            <Link href="/admin/subscription-plans" className="text-primary hover:underline">
              spravovat
            </Link>
            )
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
