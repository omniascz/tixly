'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney, isCurrency } from '@/lib/format';

interface FraudOrder {
  id: string;
  status: string;
  total_amount: number;
  currency: string;
  created_at: string;
  buyer_email: string;
  buyer_name: string | null;
  event_title: string;
  fraud_score: number;
  fraud_signals: { topReasons?: string[]; probability?: number };
}

const REASON_LABELS: Record<string, string> = {
  disposableEmail: '📧 Disposable e-mail',
  emailVelocity: '⚡ Email velocity',
  ipVelocity: '🌐 IP velocity',
  highValue: '💰 High value',
  newUserHighValue: '🆕 New user + high value',
  botHistory: '🤖 Bot history',
  geoMismatch: '🗺 Geo mismatch',
  fastFormFill: '⚡ Fast form fill',
  emailNamePatternMismatch: '📛 Email/name mismatch',
};

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

export default function FraudQueuePage() {
  const [orders, setOrders] = useState<FraudOrder[]>([]);
  const [decision, setDecision] = useState<'review' | 'block'>('review');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [decision]);

  async function load() {
    const res = await authFetch(`/api/admin/fraud-queue?decision=${decision}`);
    if (!res.ok) {
      setError(`HTTP ${res.status}`);
      return;
    }
    setOrders((((await res.json()) as { orders: FraudOrder[] }).orders) ?? []);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="🛡 Fraud queue"
        description="Orders flagged ML modelem na manual review nebo block. Score 75+ = auto-block, 40-74 = review."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setDecision('review')}
          className={
            decision === 'review'
              ? 'rounded-md bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-900'
              : 'rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted'
          }
        >
          ⚠ Review queue
        </button>
        <button
          type="button"
          onClick={() => setDecision('block')}
          className={
            decision === 'block'
              ? 'rounded-md bg-rose-100 px-3 py-1.5 text-sm font-medium text-rose-900'
              : 'rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted'
          }
        >
          ✗ Blocked
        </button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{orders.length} orders</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné flagged orders.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Score</th>
                  <th>Buyer</th>
                  <th>Event</th>
                  <th className="text-right">Total</th>
                  <th>Reasons</th>
                  <th>Status</th>
                  <th>Akce</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const ccy = isCurrency(o.currency) ? o.currency : 'CZK';
                  const reasons = (o.fraud_signals?.topReasons ?? []);
                  return (
                    <tr key={o.id} className="border-b">
                      <td className="py-2">
                        <span
                          className={`rounded px-2 py-0.5 text-sm font-bold tabular-nums ${
                            o.fraud_score >= 75
                              ? 'bg-rose-100 text-rose-900'
                              : o.fraud_score >= 40
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-emerald-100 text-emerald-900'
                          }`}
                        >
                          {o.fraud_score}
                        </span>
                      </td>
                      <td>
                        <div className="text-xs">{o.buyer_email}</div>
                        {o.buyer_name ? (
                          <div className="text-xs text-muted-foreground">{o.buyer_name}</div>
                        ) : null}
                      </td>
                      <td className="text-xs">{o.event_title}</td>
                      <td className="text-right tabular-nums">{formatMoney(o.total_amount, ccy)}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {reasons.slice(0, 3).map((r) => (
                            <span
                              key={r}
                              className="rounded bg-muted px-1.5 py-0.5 text-[10px]"
                              title={r}
                            >
                              {REASON_LABELS[r] ?? r}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="text-xs">
                        <span
                          className={
                            o.status === 'paid' || o.status === 'paid_partial'
                              ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800'
                              : o.status === 'pending'
                                ? 'rounded-full bg-amber-100 px-2 py-0.5 text-amber-800'
                                : 'rounded-full bg-slate-100 px-2 py-0.5 text-slate-700'
                          }
                        >
                          {o.status}
                        </span>
                      </td>
                      <td>
                        <Link
                          href={`/admin/orders/${o.id}`}
                          className="text-xs text-primary hover:underline"
                        >
                          Detail →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
