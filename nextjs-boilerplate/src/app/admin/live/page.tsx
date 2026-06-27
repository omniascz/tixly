'use client';

/**
 * /admin/live — Real-time promotér dashboard (PWA shortcut cíl)
 *
 * Přehled prodejů napříč všemi aktivními akcemi v reálném čase:
 * - SSE stream z /api/admin/sales-stream (3s refresh)
 * - Dnes / 7 dní / 30 dní přepínač
 * - Top akce dle tržby
 * - Poslední transakce live
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, TrendingUp, Ticket, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/admin/PageHeader';

interface Sale {
  id: string;
  event_title: string;
  event_id: string;
  total_amount: number;
  currency: string;
  ticket_count: number;
  created_at: string;
}

interface StreamData {
  recentSales: Sale[];
  totals: {
    today_revenue: number;
    today_orders: number;
    today_tickets: number;
    currency: string;
  };
}

function fmt(halire: number, currency: string): string {
  const amount = halire / 100;
  if (currency === 'CZK') return `${amount.toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
  if (currency === 'EUR') return `€${amount.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${amount} ${currency}`;
}

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `před ${sec}s`;
  if (sec < 3600) return `před ${Math.floor(sec / 60)}min`;
  return `před ${Math.floor(sec / 3600)}h`;
}

export default function LivePage() {
  const [data, setData] = useState<StreamData | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const esSrc = useRef<EventSource | null>(null);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const url = token
      ? `/api/admin/sales-stream?token=${encodeURIComponent(token)}`
      : '/api/admin/sales-stream';

    const es = new EventSource(url);
    esSrc.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const d = JSON.parse(e.data) as StreamData;
        setData(d);
        setLastUpdate(new Date());
      } catch {
        // ignore parse errors
      }
    };

    return () => {
      es.close();
    };
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live přehled prodejů"
        description="Real-time stream transakcí napříč všemi vašimi akcemi."
        actions={
          <div className="flex items-center gap-2 text-sm">
            <div className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-muted-foreground">{connected ? 'Živě' : 'Odpojeno'}</span>
            {lastUpdate && (
              <span className="text-xs text-muted-foreground">
                · aktualizováno {lastUpdate.toLocaleTimeString('cs-CZ')}
              </span>
            )}
          </div>
        }
      />

      {/* Dnešní metriky */}
      {data ? (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="py-4 text-center">
              <div className="flex justify-center mb-1">
                <TrendingUp className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="text-2xl font-bold text-emerald-700">
                {fmt(data.totals.today_revenue, data.totals.currency)}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Tržba dnes</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <div className="flex justify-center mb-1">
                <Activity className="h-5 w-5 text-blue-600" />
              </div>
              <div className="text-2xl font-bold">{data.totals.today_orders}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Objednávky dnes</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <div className="flex justify-center mb-1">
                <Ticket className="h-5 w-5 text-violet-600" />
              </div>
              <div className="text-2xl font-bold">{data.totals.today_tickets}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Vstupenek dnes</div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="py-4 text-center">
                <div className="h-8 w-20 mx-auto animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Live transakce */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <RefreshCw className="h-4 w-4 text-primary" />
            Poslední transakce
            {data && (
              <Badge variant="secondary" className="ml-auto text-xs">
                {data.recentSales.length} záznamů
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!data ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : data.recentSales.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Zatím žádné transakce dnes.</p>
          ) : (
            <div className="space-y-1">
              {data.recentSales.map((sale, i) => (
                <div
                  key={sale.id}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${i === 0 ? 'bg-emerald-50 border border-emerald-100' : 'hover:bg-muted/50'}`}
                >
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/admin/events/${sale.event_id}/sales-report`}
                      className="font-medium hover:text-primary truncate block"
                    >
                      {sale.event_title}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {sale.ticket_count} {sale.ticket_count === 1 ? 'vstupenka' : 'vstupenky'} · {timeAgo(sale.created_at)}
                    </span>
                  </div>
                  <span className="font-semibold tabular-nums text-emerald-700">
                    +{fmt(sale.total_amount, sale.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: '📊 Reports', href: '/admin/reports' },
          { label: '🎟 Akce', href: '/admin/events' },
          { label: '📦 Objednávky', href: '/admin/orders' },
          { label: '🔔 Alerty', href: '/admin/alerts' },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-lg border p-3 text-center text-sm font-medium hover:bg-muted transition"
          >
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
