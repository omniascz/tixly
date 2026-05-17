'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';

interface RefundRequestItem {
  id: string;
  orderId: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'escalated';
  reason: string;
  reasonCategory: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  reviewerNote: string | null;
  refundedHalire: number | null;
  orderTotalHalire: number;
  orderCurrency: string;
  buyerEmail: string;
  buyerName: string | null;
  eventTitle: string | null;
  eventDateStart: string | null;
}

const REASON_LABELS: Record<string, string> = {
  illness: '🤒 Nemoc',
  family_emergency: '🚨 Rodinná situace',
  travel_disruption: '✈️ Zrušená doprava',
  duplicate_purchase: '🔁 Dvojí nákup',
  event_changed: '📅 Změna akce',
  other: '✍️ Jiné',
};

const STATUS_COLORS: Record<RefundRequestItem['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-slate-100 text-slate-700',
  escalated: 'bg-violet-100 text-violet-800',
};

function fmtMoney(halire: number, currency: string): string {
  return `${(halire / 100).toLocaleString('cs-CZ')} ${currency === 'EUR' ? '€' : 'Kč'}`;
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function RefundRequestsPage() {
  const [items, setItems] = useState<RefundRequestItem[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  async function load() {
    const res = await authFetch(`/api/admin/refund-requests?status=${filter}`);
    if (res.ok) {
      const j = (await res.json()) as { items: RefundRequestItem[] };
      setItems(j.items);
    }
  }

  useEffect(() => {
    void load();
  }, [filter]);

  async function decide(id: string, decision: 'approve' | 'reject') {
    if (
      decision === 'reject' &&
      !confirm('Zamítnout refund? Kupec dostane mail s důvodem.')
    )
      return;
    setBusy(id);
    try {
      const res = await authFetch(`/api/admin/refund-requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ decision, note: note[id] ?? undefined }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        alert(`Chyba: ${j.error ?? res.status}`);
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Refund žádosti"
        description="Žádosti o refund mimo self-service okno. Vyřiď do 48h."
      />

      <div className="flex gap-2">
        <Button
          variant={filter === 'pending' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('pending')}
        >
          Pending ({items.filter((i) => i.status === 'pending').length})
        </Button>
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('all')}
        >
          Vše
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Žádné žádosti.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <CardTitle className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">
                      {item.eventTitle ?? '?'} —{' '}
                      <span className="text-muted-foreground">
                        {item.buyerName ?? item.buyerEmail}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {fmtMoney(item.orderTotalHalire, item.orderCurrency)} ·{' '}
                      {new Date(item.requestedAt).toLocaleString('cs-CZ')}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[item.status]}`}
                  >
                    {item.status}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {item.reasonCategory ? (
                  <p className="text-xs">
                    <span className="font-medium">Kategorie:</span>{' '}
                    {REASON_LABELS[item.reasonCategory] ?? item.reasonCategory}
                  </p>
                ) : null}
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <span className="text-xs font-medium uppercase text-muted-foreground">
                    Důvod:
                  </span>
                  <p className="mt-1 whitespace-pre-wrap">{item.reason}</p>
                </div>

                {item.status === 'pending' ? (
                  <div className="space-y-2">
                    <textarea
                      className="w-full rounded-md border bg-background px-3 py-2 text-xs"
                      rows={2}
                      placeholder="Volitelný komentář (důvod approval/rejection)"
                      value={note[item.id] ?? ''}
                      onChange={(e) => setNote({ ...note, [item.id]: e.target.value })}
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={() => decide(item.id, 'approve')}
                        disabled={busy === item.id}
                      >
                        ✓ Schválit refund
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => decide(item.id, 'reject')}
                        disabled={busy === item.id}
                      >
                        ✗ Zamítnout
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    {item.reviewerNote ? (
                      <p>
                        <span className="font-medium">Poznámka:</span> {item.reviewerNote}
                      </p>
                    ) : null}
                    {item.refundedHalire != null ? (
                      <p>
                        Vráceno: {fmtMoney(item.refundedHalire, item.orderCurrency)}
                      </p>
                    ) : null}
                    {item.reviewedAt ? (
                      <p>
                        Rozhodnuto: {new Date(item.reviewedAt).toLocaleString('cs-CZ')}
                      </p>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
