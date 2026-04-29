'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';
import { formatMoney, isCurrency } from '@/lib/format';

interface ReportData {
  event: { id: string; title: string; currency: string };
  byTicketType: { ticketTypeId: string; name: string; soldQty: number; grossHalire: number }[];
  addons: { count: number; totalHalire: number };
  grossOrders: { count: number; totalHalire: number };
  insurance: { count: number; premiumTotalHalire: number };
  refunds: { count: number; totalHalire: number };
  dailySales: { day: string; count: number; revenueHalire: number }[];
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

export default function SalesReportPage() {
  const params = useParams();
  const eventId = String(params.id);
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const res = await authFetch(`/api/admin/events/${eventId}/sales-report`);
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        setData((await res.json()) as ReportData);
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [eventId]);

  async function downloadCsv() {
    const res = await authFetch(`/api/admin/events/${eventId}/sales-report?format=csv`);
    if (!res.ok) {
      setError(`Export failed: ${res.status}`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ??
      `tixly-sales-${eventId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
        {error}
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Načítání…</p>;
  }
  const ccy = isCurrency(data.event.currency) ? data.event.currency : 'CZK';

  const totalGross = data.byTicketType.reduce((s, r) => s + r.grossHalire, 0);
  const netRevenue = data.grossOrders.totalHalire - data.refunds.totalHalire;

  // Max for daily chart
  const maxDaily = Math.max(1, ...data.dailySales.map((d) => d.revenueHalire));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Sales report — ${data.event.title}`}
        description="Tržby per ticket type, add-ons, refundace, denní průběh."
        actions={
          <Button onClick={downloadCsv} variant="outline" size="sm">
            ⬇ Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Hrubá tržba" value={formatMoney(data.grossOrders.totalHalire, ccy)} sub={`${data.grossOrders.count} objednávek`} />
        <Stat label="Add-ony" value={formatMoney(data.addons.totalHalire, ccy)} sub={`${data.addons.count} ks`} />
        <Stat label="Pojistka" value={formatMoney(data.insurance.premiumTotalHalire, ccy)} sub={`${data.insurance.count} ks`} />
        <Stat label="Refundace" value={formatMoney(data.refunds.totalHalire, ccy)} sub={`${data.refunds.count} ks`} tone="negative" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Per ticket type</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2">Typ</th>
                <th className="text-right">Prodáno</th>
                <th className="text-right">Hrubá tržba</th>
                <th className="text-right">% z eventu</th>
              </tr>
            </thead>
            <tbody>
              {data.byTicketType.map((r) => {
                const pct = totalGross > 0 ? (r.grossHalire / totalGross) * 100 : 0;
                return (
                  <tr key={r.ticketTypeId} className="border-b">
                    <td className="py-2">{r.name}</td>
                    <td className="text-right tabular-nums">{r.soldQty.toLocaleString('cs-CZ')}</td>
                    <td className="text-right tabular-nums">
                      {formatMoney(r.grossHalire, ccy)}
                    </td>
                    <td className="text-right text-muted-foreground tabular-nums">
                      {pct.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Denní tržby (posledních 30 dní)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.dailySales.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádné prodeje.</p>
          ) : (
            <ul className="space-y-1">
              {data.dailySales.map((d) => {
                const w = (d.revenueHalire / maxDaily) * 100;
                return (
                  <li key={d.day} className="flex items-center gap-2 text-xs">
                    <span className="w-24 tabular-nums text-muted-foreground">
                      {new Date(d.day).toLocaleDateString('cs-CZ')}
                    </span>
                    <div className="relative h-5 flex-1 rounded bg-muted/30">
                      <div
                        className="h-full rounded bg-primary/70"
                        style={{ width: `${w}%` }}
                      />
                    </div>
                    <span className="w-32 text-right tabular-nums">
                      {formatMoney(d.revenueHalire, ccy)}
                    </span>
                    <span className="w-12 text-right text-muted-foreground tabular-nums">
                      {d.count}×
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bilance</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b">
                <td className="py-2">Hrubé tržby</td>
                <td className="text-right tabular-nums">
                  {formatMoney(data.grossOrders.totalHalire, ccy)}
                </td>
              </tr>
              <tr className="border-b text-rose-700">
                <td className="py-2">− Refundace</td>
                <td className="text-right tabular-nums">
                  −{formatMoney(data.refunds.totalHalire, ccy)}
                </td>
              </tr>
              <tr className="border-b font-semibold">
                <td className="py-2">Net revenue</td>
                <td className="text-right tabular-nums">
                  {formatMoney(netRevenue, ccy)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">
            Net revenue = hrubé tržby (paid + paid_partial) minus refundace. Add-ony a pojistné
            jsou součástí order total_amount, takže se nepřičítají zvlášť.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'negative';
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-xl font-bold tabular-nums ${tone === 'negative' ? 'text-rose-700' : ''}`}
      >
        {value}
      </div>
      {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
