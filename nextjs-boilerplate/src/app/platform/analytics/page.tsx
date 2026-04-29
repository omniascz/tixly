'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/format';

interface AnalyticsData {
  overview: {
    totalRevenueHalire: number;
    totalTicketsSold: number;
    activePromoters: number;
    activeEvents: number;
    windowDays: number;
  };
  topPromoters: {
    promoterId: string;
    promoterName: string;
    revenueHalire: number;
    ticketsSold: number;
    eventsCount: number;
  }[];
  daily: { day: string; revenueHalire: number; orders: number }[];
  conversion: {
    totalOrders: number;
    paidOrders: number;
    refundedOrders: number;
    conversionRatePct: number;
    refundRatePct: number;
  };
  fraud: {
    totalScored: number;
    blockedCount: number;
    reviewCount: number;
    avgScore: number | null;
    blockRatePct: number;
  };
}

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export default function PlatformAnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const res = await authFetch('/api/platform/analytics');
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        setData(await res.json());
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, []);

  if (error) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
        {error}
      </div>
    );
  }
  if (!data) return <p className="text-sm text-muted-foreground">Načítání…</p>;

  const maxDaily = Math.max(1, ...data.daily.map((d) => d.revenueHalire));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Platform Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Cross-promoter overview za posledních {data.overview.windowDays} dní.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Celkové tržby" value={formatMoney(data.overview.totalRevenueHalire, 'CZK')} />
        <Stat label="Prodáno lístků" value={data.overview.totalTicketsSold.toLocaleString('cs-CZ')} />
        <Stat label="Aktivní promotéři" value={data.overview.activePromoters.toString()} />
        <Stat label="Nadcházející akce" value={data.overview.activeEvents.toString()} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Konverze</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Row label="Celkem objednávek" value={data.conversion.totalOrders.toString()} />
            <Row label="Zaplaceno" value={data.conversion.paidOrders.toString()} />
            <Row label="Refundováno" value={data.conversion.refundedOrders.toString()} tone="negative" />
            <Row
              label="Konverze (paid / total)"
              value={`${data.conversion.conversionRatePct}%`}
              big
            />
            <Row
              label="Refund rate"
              value={`${data.conversion.refundRatePct}%`}
              tone="negative"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fraud detekce</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Row label="Skórované objednávky" value={data.fraud.totalScored.toString()} />
            <Row label="Blokované" value={data.fraud.blockedCount.toString()} tone="negative" />
            <Row label="K manuálnímu review" value={data.fraud.reviewCount.toString()} />
            <Row
              label="Průměrný score"
              value={data.fraud.avgScore !== null ? data.fraud.avgScore.toFixed(1) : '—'}
            />
            <Row
              label="Block rate"
              value={`${data.fraud.blockRatePct}%`}
              tone={data.fraud.blockRatePct > 5 ? 'negative' : undefined}
              big
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top promotéři ({data.topPromoters.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {data.topPromoters.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádná data.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Promotér</th>
                  <th className="text-right">Tržby (30d)</th>
                  <th className="text-right">Lístků</th>
                  <th className="text-right">Akcí</th>
                </tr>
              </thead>
              <tbody>
                {data.topPromoters.map((p) => (
                  <tr key={p.promoterId} className="border-b">
                    <td className="py-2 font-medium">{p.promoterName}</td>
                    <td className="text-right tabular-nums">
                      {formatMoney(p.revenueHalire, 'CZK')}
                    </td>
                    <td className="text-right tabular-nums">{p.ticketsSold}</td>
                    <td className="text-right tabular-nums">{p.eventsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Denní tržby (30d)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.daily.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné prodeje.</p>
          ) : (
            <ul className="space-y-1">
              {data.daily.map((d) => {
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
                      {formatMoney(d.revenueHalire, 'CZK')}
                    </span>
                    <span className="w-12 text-right text-muted-foreground tabular-nums">
                      {d.orders}×
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Row({
  label,
  value,
  big,
  tone,
}: {
  label: string;
  value: string;
  big?: boolean;
  tone?: 'negative';
}) {
  return (
    <div className="flex items-center justify-between border-b py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`tabular-nums ${big ? 'text-lg font-bold' : 'font-medium'} ${tone === 'negative' ? 'text-rose-700' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}
