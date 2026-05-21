'use client';

import { useEffect, useRef, useState } from 'react';
import { TrendingUp, Activity, Wifi, WifiOff } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface SaleEvent {
  id: number;
  event_id: string;
  event_title: string;
  order_id: string;
  amount_halire: number;
  currency: string;
  ticket_count: number;
  buyer_country: string | null;
  created_at: string;
}

interface Stats {
  countToday: number;
  revenueToday: number;
  countHour: number;
  revenueHour: number;
}

const MAX_RECENT_SALES = 30;

export default function LiveDashboardPage() {
  const [sales, setSales] = useState<SaleEvent[]>([]);
  const [stats, setStats] = useState<Stats>({
    countToday: 0, revenueToday: 0, countHour: 0, revenueHour: 0,
  });
  const [connected, setConnected] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    function connect() {
      const es = new EventSource('/api/admin/sales-stream');
      esRef.current = es;

      es.addEventListener('hello', () => {
        setConnected(true);
        setReconnectAttempt(0);
      });

      es.addEventListener('sale', (e) => {
        try {
          const sale = JSON.parse(e.data) as SaleEvent;
          setSales((prev) => [sale, ...prev].slice(0, MAX_RECENT_SALES));
        } catch {
          // ignore parse error
        }
      });

      es.addEventListener('stats', (e) => {
        try {
          const s = JSON.parse(e.data) as Stats;
          setStats(s);
        } catch {
          // ignore
        }
      });

      es.onerror = () => {
        setConnected(false);
        es.close();
        // Auto-reconnect after 5s
        setTimeout(() => {
          setReconnectAttempt((n) => n + 1);
          connect();
        }, 5000);
      };
    }
    connect();
    return () => {
      esRef.current?.close();
    };
  }, []);

  function formatMoney(halire: number, currency: string): string {
    const kc = halire / 100;
    const symbol = currency === 'EUR' ? '€' : 'Kč';
    return `${kc.toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} ${symbol}`;
  }

  function timeAgo(iso: string): string {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 5) return 'právě teď';
    if (diff < 60) return `před ${Math.floor(diff)}s`;
    if (diff < 3600) return `před ${Math.floor(diff / 60)} min`;
    return new Date(iso).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live dashboard"
        description="Real-time prodejní stream — TM1 Sales parita"
      />

      {/* Connection status */}
      <div className={`flex items-center gap-2 rounded-md border p-2 text-xs ${
        connected ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'
      }`}>
        {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
        {connected ? (
          <span>Připojeno · server-sent events</span>
        ) : (
          <span>Odpojeno — pokus o reconnect #{reconnectAttempt}</span>
        )}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Tržby dnes</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {formatMoney(stats.revenueToday, 'CZK')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Objednávek dnes</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{stats.countToday}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Tržby — poslední hodina</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
              {formatMoney(stats.revenueHour, 'CZK')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Objednávek — hodina</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{stats.countHour}</p>
          </CardContent>
        </Card>
      </div>

      {/* Live sales feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 animate-pulse text-emerald-600" />
            Aktivita posledních prodejů
          </CardTitle>
          <CardDescription>
            Stream se aktualizuje každých 3s. Max {MAX_RECENT_SALES} prodejů zobrazeno.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sales.length === 0 ? (
            <div className="py-8 text-center">
              <TrendingUp className="mx-auto mb-2 h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Žádné prodeje. Stream se aktivuje po prvním paid orderu.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {sales.map((sale) => (
                <li
                  key={sale.id}
                  className="flex items-center justify-between rounded-md border bg-card p-3 text-sm transition animate-in fade-in"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{sale.event_title}</p>
                    <p className="text-xs text-muted-foreground">
                      {sale.ticket_count}× lístek · {sale.buyer_country ?? '—'} · {timeAgo(sale.created_at)}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums text-emerald-700">
                    +{formatMoney(sale.amount_halire, sale.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
