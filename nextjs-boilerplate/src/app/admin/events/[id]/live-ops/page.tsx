'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney, isCurrency } from '@/lib/format';

interface LiveOpsData {
  event: { id: string; title: string; dateStart: string; queueEnabled: boolean; currency: string };
  sales: { ticketsSold: number; revenueHalire: number; refundedCount: number };
  scanRate: {
    last5min: number;
    last15min: number;
    last60min: number;
    usedTotal: number;
    redemptionTotal: number;
  };
  zones: { zoneId: string | null; zoneName: string; count: number }[];
  days: { eventDayId: string; label: string | null; startsAt: string; count: number }[];
  queue: { waiting: number; admitted: number };
  inventory: {
    id: string;
    name: string;
    totalQty: number | null;
    remainingQty: number | null;
    soldQty: number | null;
  }[];
  timestamp: string;
}

const POLL_MS = 5000;

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export default function LiveOpsPage() {
  const params = useParams();
  const eventId = String(params.id);
  const [data, setData] = useState<LiveOpsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await authFetch(`/api/admin/events/${eventId}/live-ops`);
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        setData((await res.json()) as LiveOpsData);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    void poll();
    if (!paused) {
      intervalRef.current = setInterval(poll, POLL_MS);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [eventId, paused]);

  if (error && !data) {
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
  const totalScanned = data.scanRate.usedTotal + data.scanRate.redemptionTotal;
  const occupancyPct =
    data.sales.ticketsSold > 0
      ? Math.round((totalScanned / data.sales.ticketsSold) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Live Ops — ${data.event.title}`}
        description={`Auto-refresh ${POLL_MS / 1000}s · ${new Date(data.timestamp).toLocaleTimeString('cs-CZ')}`}
        actions={
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${paused ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Prodáno lístků" value={data.sales.ticketsSold.toLocaleString('cs-CZ')} />
        <Stat label="Tržby" value={formatMoney(data.sales.revenueHalire, ccy)} />
        <Stat
          label="Naskenováno"
          value={`${totalScanned.toLocaleString('cs-CZ')}`}
          sub={`${occupancyPct}% obsazenost`}
        />
        <Stat
          label="Refundace"
          value={data.sales.refundedCount.toLocaleString('cs-CZ')}
          tone="negative"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scan rate</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Posledních 5 min" value={data.scanRate.last5min.toString()} />
            <Stat label="Posledních 15 min" value={data.scanRate.last15min.toString()} />
            <Stat label="Posledních 60 min" value={data.scanRate.last60min.toString()} />
          </div>
        </CardContent>
      </Card>

      {data.event.queueEnabled ? (
        <Card>
          <CardHeader>
            <CardTitle>Virtuální fronta</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Čekající" value={data.queue.waiting.toString()} />
              <Stat label="Na pokladně" value={data.queue.admitted.toString()} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {data.zones.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Vstupy podle zón</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.zones.map((z) => (
                <li key={z.zoneId ?? z.zoneName} className="flex items-center justify-between py-2 text-sm">
                  <span>{z.zoneName}</span>
                  <span className="font-medium tabular-nums">{z.count.toLocaleString('cs-CZ')}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {data.days.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Vstupy podle dní</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.days.map((d) => (
                <li key={d.eventDayId} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <strong>{d.label ?? '—'}</strong>{' '}
                    <span className="text-xs text-muted-foreground">
                      {new Date(d.startsAt).toLocaleDateString('cs-CZ')}
                    </span>
                  </span>
                  <span className="font-medium tabular-nums">{d.count.toLocaleString('cs-CZ')}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Inventář vstupenek</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2">Typ</th>
                <th className="text-right">Prodáno</th>
                <th className="text-right">Zbývá</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.inventory.map((i) => {
                const soldOut = i.remainingQty !== null && i.remainingQty <= 0;
                const lowStock =
                  i.totalQty !== null && i.remainingQty !== null && i.remainingQty / i.totalQty < 0.1;
                return (
                  <tr key={i.id} className="border-b">
                    <td className="py-2">
                      {i.name}
                      {soldOut ? (
                        <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-800">
                          vyprodáno
                        </span>
                      ) : lowStock ? (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
                          nízký stav
                        </span>
                      ) : null}
                    </td>
                    <td className="text-right tabular-nums">
                      {i.soldQty?.toLocaleString('cs-CZ') ?? '—'}
                    </td>
                    <td className="text-right tabular-nums">
                      {i.remainingQty?.toLocaleString('cs-CZ') ?? '∞'}
                    </td>
                    <td className="text-right tabular-nums text-muted-foreground">
                      {i.totalQty?.toLocaleString('cs-CZ') ?? '∞'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
        className={`mt-1 text-2xl font-bold tabular-nums ${tone === 'negative' ? 'text-rose-700' : ''}`}
      >
        {value}
      </div>
      {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
