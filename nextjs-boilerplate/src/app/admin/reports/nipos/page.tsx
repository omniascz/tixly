'use client';

import { useEffect, useState, type JSX } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface NiposReportRow {
  category: string;
  eventsPlanned: number;
  eventsHeld: number;
  visitorsTotal: number;
  visitorsPaying: number;
  grossRevenueHalire: number;
  refundedTickets: number;
  refundedRevenueHalire: number;
}

interface NiposReportSummary {
  promoterId: string;
  promoterName: string;
  periodStart: string;
  periodEnd: string;
  totalEvents: number;
  totalVisitors: number;
  totalRevenueHalire: number;
  byCategory: NiposReportRow[];
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

function quarterStartIso(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q, 1).toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NiposReportPage(): JSX.Element {
  const [from, setFrom] = useState(quarterStartIso());
  const [to, setTo] = useState(todayIso());
  const [data, setData] = useState<NiposReportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const r = await authFetch(`/api/admin/reports/nipos?from=${from}&to=${to}`);
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? `HTTP ${r.status}`);
        return;
      }
      setData((await r.json()) as NiposReportSummary);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function downloadCsv(): void {
    const url = `/api/admin/reports/nipos?from=${from}&to=${to}&format=csv`;
    window.open(url, '_blank');
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="NIPOS reporting"
        description="Statistiky pro Národní informační a poradenské středisko pro kulturu (NIPOS Kult 1-01 výkaz)."
      />

      <Card>
        <CardHeader>
          <CardTitle>Vyber období</CardTitle>
          <CardDescription>
            Default = aktuální čtvrtletí. Výkaz lze stáhnout jako CSV s
            oddělovači středník (kompatibilní s NIPOS šablonou).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Od</label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                data-testid="nipos-from"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Do</label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                data-testid="nipos-to"
              />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={() => void load()} disabled={busy} data-testid="nipos-refresh">
                {busy ? 'Načítám…' : 'Aktualizovat'}
              </Button>
              <Button
                variant="outline"
                onClick={downloadCsv}
                disabled={!data}
                data-testid="nipos-download-csv"
              >
                Stáhnout CSV
              </Button>
            </div>
          </div>
          {error ? (
            <p className="text-sm text-rose-700" data-testid="nipos-error">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Souhrn za období</CardTitle>
              <CardDescription>
                {data.periodStart} až {data.periodEnd}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div data-testid="nipos-total-events">
                <div className="text-xs uppercase text-muted-foreground">Celkem akcí</div>
                <div className="text-2xl font-bold tabular-nums">{data.totalEvents}</div>
              </div>
              <div data-testid="nipos-total-visitors">
                <div className="text-xs uppercase text-muted-foreground">Celkem návštěvníků</div>
                <div className="text-2xl font-bold tabular-nums">{data.totalVisitors}</div>
              </div>
              <div data-testid="nipos-total-revenue">
                <div className="text-xs uppercase text-muted-foreground">Hrubý příjem</div>
                <div className="text-2xl font-bold tabular-nums">
                  {(data.totalRevenueHalire / 100).toLocaleString('cs-CZ', {
                    maximumFractionDigits: 0,
                  })}{' '}
                  Kč
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Podle kategorie</CardTitle>
            </CardHeader>
            <CardContent>
              {data.byCategory.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Žádné akce v tomto období.
                </p>
              ) : (
                <table className="w-full text-sm" data-testid="nipos-table">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2">Kategorie</th>
                      <th className="text-right">Plánováno</th>
                      <th className="text-right">Odehráno</th>
                      <th className="text-right">Návštěvníci</th>
                      <th className="text-right">Platící</th>
                      <th className="text-right">Příjem</th>
                      <th className="text-right">Vrácené</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCategory.map((r) => (
                      <tr key={r.category} className="border-b">
                        <td className="py-2">{r.category}</td>
                        <td className="text-right tabular-nums">{r.eventsPlanned}</td>
                        <td className="text-right tabular-nums">{r.eventsHeld}</td>
                        <td className="text-right tabular-nums">{r.visitorsTotal}</td>
                        <td className="text-right tabular-nums">{r.visitorsPaying}</td>
                        <td className="text-right tabular-nums">
                          {(r.grossRevenueHalire / 100).toLocaleString('cs-CZ')} Kč
                        </td>
                        <td className="text-right tabular-nums">
                          {r.refundedTickets > 0
                            ? `${r.refundedTickets} (${(r.refundedRevenueHalire / 100).toLocaleString('cs-CZ')} Kč)`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            <strong>Pozn.:</strong> Výkaz pro NIPOS odevzdává se zpravidla
            1× ročně (formulář Kult 1-01 pro divadla, V 5-01 pro koncerty).
            Tixly poskytuje agregaci, papírové podání zůstává na pořadateli.
            Viz <a href="https://www.nipos-mk.cz/" className="underline" target="_blank" rel="noreferrer">nipos-mk.cz</a>.
          </div>
        </>
      ) : null}
    </div>
  );
}
