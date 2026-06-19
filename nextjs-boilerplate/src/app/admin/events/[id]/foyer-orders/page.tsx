'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface OrderItem {
  item_name: string;
  quantity: number;
  unit_halire: number;
}

interface FoyerOrder {
  id: string;
  pickupQrToken: string;
  status: string;
  totalHalire: number;
  buyerEmail: string | null;
  createdAt: string;
  items: OrderItem[];
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default function FoyerOrdersDashboardPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [orders, setOrders] = useState<FoyerOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadOrders() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/admin/events/${eventId}/foyer-orders?status=pending`,
        { headers: authHeaders() },
      );
      if (!r.ok) {
        setError(`HTTP ${r.status}`);
        return;
      }
      const d = (await r.json()) as { orders: FoyerOrder[] };
      setOrders(d.orders);
      setLastRefresh(new Date());
    } catch {
      setError('Síťová chyba při načítání objednávek');
    } finally {
      setLoading(false);
    }
  }

  async function markReady(order: FoyerOrder) {
    try {
      const r = await fetch(`/api/foyer-orders/${order.id}/status`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status: 'ready' }),
      });
      if (!r.ok) {
        const d = (await r.json()) as { error?: string };
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
    } catch {
      setError('Síťová chyba');
    }
  }

  useEffect(() => {
    void loadOrders();
    intervalRef.current = setInterval(() => {
      void loadOrders();
    }, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [eventId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Foyer bar — objednávky"
        description="Předobjednávky k přípravě. Obnovuje se každých 30 sekund."
        actions={
          <Button variant="outline" size="sm" onClick={() => void loadOrders()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Obnovit
          </Button>
        }
      />

      {lastRefresh ? (
        <p className="text-xs text-muted-foreground">
          Poslední aktualizace: {lastRefresh.toLocaleTimeString('cs-CZ')}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      {orders.length === 0 && !loading ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Žádné čekající objednávky. Stránka se automaticky obnovuje.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orders.map((order) => (
            <Card key={order.id} className="relative">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  #{order.pickupQrToken.slice(0, 8).toUpperCase()}
                </CardTitle>
                {order.buyerEmail ? (
                  <p className="text-xs text-muted-foreground">{order.buyerEmail}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {new Date(order.createdAt).toLocaleTimeString('cs-CZ')}
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                <ul className="space-y-1">
                  {order.items.map((item, idx) => (
                    <li key={idx} className="flex justify-between text-sm">
                      <span>
                        {item.quantity}× {item.item_name}
                      </span>
                      <span className="text-muted-foreground">
                        {((item.unit_halire * item.quantity) / 100).toLocaleString('cs-CZ')} Kč
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="border-t pt-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    Celkem: {(order.totalHalire / 100).toLocaleString('cs-CZ')} Kč
                  </span>
                  <Button
                    size="sm"
                    className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => void markReady(order)}
                  >
                    <CheckCircle className="h-4 w-4" />
                    Připraveno
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
