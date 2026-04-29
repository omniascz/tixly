'use client';

import { useEffect, useState } from 'react';

interface WebhookItem {
  id: string;
  orderId: string;
  eventType: string;
  gopayStatus: string | null;
  amountHalire: number | null;
  rawPayload: unknown;
  createdAt: string;
  paymentProvider: string;
  order: {
    status: string;
    totalHalire: number;
    buyerEmail: string;
    eventTitle: string | null;
  };
}

const EVENT_TONE: Record<string, string> = {
  PAID: 'bg-emerald-100 text-emerald-800',
  CANCELED: 'bg-rose-100 text-rose-800',
  TIMEOUTED: 'bg-amber-100 text-amber-800',
  REFUNDED: 'bg-blue-100 text-blue-800',
};

export default function WebhooksPage() {
  const [items, setItems] = useState<WebhookItem[]>([]);
  const [provider, setProvider] = useState('');
  const [eventType, setEventType] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (provider) params.set('provider', provider);
      if (eventType) params.set('eventType', eventType);
      params.set('limit', '50');
      const token = localStorage.getItem('accessToken');
      const r = await fetch(`/api/platform/webhooks?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (r.ok) {
        const d = (await r.json()) as { items: WebhookItem[] };
        setItems(d.items);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [provider, eventType]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Webhooks</h1>
        <p className="text-sm text-muted-foreground">
          Debug viewer plateb (mock GoPay i reálná). Klikni řádek pro raw payload.
        </p>
      </div>

      <div className="flex gap-3 rounded-md border bg-card p-3">
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          <option value="">— provider —</option>
          <option value="gopay">GoPay</option>
          <option value="stripe">Stripe</option>
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
        >
          <option value="">— event —</option>
          <option value="PAID">PAID</option>
          <option value="CANCELED">CANCELED</option>
          <option value="TIMEOUTED">TIMEOUTED</option>
          <option value="REFUNDED">REFUNDED</option>
        </select>
        <div className="ml-auto self-center text-xs text-muted-foreground">
          {loading ? 'Načítám…' : `${items.length} záznamů`}
        </div>
      </div>

      <div className="rounded-md border bg-card">
        {items.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Žádné webhooks. Proveď platbu v demu (`/cs/events` → koupit) a webhook
            se objeví zde.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Čas</th>
                <th>Provider</th>
                <th>Event</th>
                <th>Order</th>
                <th>Akce</th>
                <th className="text-right">Částka</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <>
                  <tr
                    key={it.id}
                    className="cursor-pointer border-b hover:bg-accent/30"
                    onClick={() =>
                      setExpanded((cur) => (cur === it.id ? null : it.id))
                    }
                  >
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(it.createdAt).toLocaleString('cs-CZ')}
                    </td>
                    <td className="text-xs uppercase">{it.paymentProvider}</td>
                    <td>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${EVENT_TONE[it.eventType] ?? 'bg-slate-100'}`}
                      >
                        {it.eventType}
                      </span>
                    </td>
                    <td className="font-mono text-xs">
                      {it.orderId.slice(0, 8)}
                    </td>
                    <td className="text-xs">
                      {it.order.eventTitle ?? '—'}
                      <div className="text-muted-foreground">
                        {it.order.buyerEmail}
                      </div>
                    </td>
                    <td className="text-right text-xs">
                      {it.amountHalire !== null
                        ? `${(it.amountHalire / 100).toLocaleString('cs-CZ')} Kč`
                        : `${(it.order.totalHalire / 100).toLocaleString('cs-CZ')} Kč`}
                    </td>
                  </tr>
                  {expanded === it.id ? (
                    <tr key={it.id + '-payload'} className="border-b bg-muted/40">
                      <td colSpan={6} className="px-3 py-2">
                        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                          {JSON.stringify(it.rawPayload, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ) : null}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
