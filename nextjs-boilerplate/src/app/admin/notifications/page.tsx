'use client';

import { useEffect, useState } from 'react';
import { Bell, CheckCheck, Filter, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface Notification {
  id: string;
  kind: string;
  severity: 'info' | 'warn' | 'critical' | string;
  title: string;
  body: string | null;
  link: string | null;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

const KIND_LABEL: Record<string, string> = {
  refund_request: 'Žádost o refund',
  payout_settled: 'Výplata',
  payout_failed: 'Selhání výplaty',
  rolling_reserve_released: 'Uvolnění rezervy',
  abandoned_cart_high: 'Opuštěné košíky',
  event_moderation: 'Moderace akce',
  churn_risk: 'Risk odchodu zákazníka',
  holdback_ended: 'Konec zádržného období',
  low_inventory: 'Nízká zásoba',
  general: 'Obecné',
};

const SEVERITY_TONE: Record<string, string> = {
  info: 'bg-sky-100 text-sky-800',
  warn: 'bg-amber-100 text-amber-800',
  critical: 'bg-rose-100 text-rose-800',
};

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export default function NotificationsPage(): JSX.Element {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [kindFilter, setKindFilter] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (unreadOnly) params.set('unread', '1');
      if (kindFilter) params.set('kind', kindFilter);
      params.set('limit', '100');
      const r = await authFetch(`/api/admin/notifications?${params.toString()}`);
      if (r.ok) {
        const data = (await r.json()) as { items: Notification[]; unreadCount: number };
        setItems(data.items);
        setUnreadCount(data.unreadCount);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [unreadOnly, kindFilter]);

  async function markRead(id: string): Promise<void> {
    await authFetch(`/api/admin/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readAt: true }),
    });
    void load();
  }

  async function markAllRead(): Promise<void> {
    await authFetch('/api/admin/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark-all-read' }),
    });
    void load();
  }

  async function remove(id: string): Promise<void> {
    await authFetch(`/api/admin/notifications/${id}`, { method: 'DELETE' });
    void load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifikace"
        description={`In-app alerty. ${unreadCount} nepřečtených.`}
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-medium">
              <Filter className="h-3 w-3" /> Filtr
            </label>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">— vše —</option>
              {Object.entries(KIND_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
            />
            Jen nepřečtené
          </label>
          {unreadCount > 0 ? (
            <Button onClick={markAllRead} size="sm" variant="outline" className="ml-auto">
              <CheckCheck className="mr-1 h-4 w-4" />
              Označit vše přečtené
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-2">
        {busy && items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Načítám…</p>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Bell className="mx-auto mb-3 h-8 w-8 opacity-30" />
              <p>Žádné notifikace.</p>
            </CardContent>
          </Card>
        ) : (
          items.map((n) => {
            const isUnread = !n.readAt;
            return (
              <Card key={n.id} className={isUnread ? 'border-l-4 border-l-primary' : ''}>
                <CardContent className="flex items-start gap-3 pt-6">
                  <div className="flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_TONE[n.severity] ?? 'bg-slate-100'}`}
                      >
                        {KIND_LABEL[n.kind] ?? n.kind}
                      </span>
                      <span className="font-medium">{n.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(n.createdAt).toLocaleString('cs-CZ')}
                      </span>
                    </div>
                    {n.body ? (
                      <p className="text-sm text-muted-foreground">{n.body}</p>
                    ) : null}
                    {n.link ? (
                      <Link
                        href={n.link}
                        className="inline-block text-sm text-primary underline"
                      >
                        Přejít →
                      </Link>
                    ) : null}
                  </div>
                  <div className="flex gap-1">
                    {isUnread ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => markRead(n.id)}
                        title="Označit přečtené"
                      >
                        <CheckCheck className="h-4 w-4" />
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(n.id)}
                      title="Smazat"
                    >
                      <Trash2 className="h-4 w-4 text-rose-600" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
