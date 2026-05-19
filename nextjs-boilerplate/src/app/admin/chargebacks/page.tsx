'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardContent } from '@/components/ui/card';

interface Chargeback {
  id: string;
  order_id: string;
  stripe_dispute_id: string | null;
  amount_halire: number;
  reason: string | null;
  status: string;
  holdback_applied: boolean;
  evidence_submitted_at: string | null;
  closed_at: string | null;
  created_at: string;
  event_title: string | null;
  buyer_email: string | null;
}

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

function formatCzk(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

const STATUS_COLORS: Record<string, string> = {
  needs_response: 'bg-rose-100 text-rose-900',
  under_review: 'bg-amber-100 text-amber-900',
  won: 'bg-emerald-100 text-emerald-900',
  lost: 'bg-slate-200 text-slate-900',
  warning_closed: 'bg-blue-100 text-blue-900',
};

const STATUS_LABELS: Record<string, string> = {
  needs_response: 'Vyžaduje odpověď',
  under_review: 'V přezkumu',
  won: 'Vyhráno',
  lost: 'Prohráno',
  warning_closed: 'Uzavřeno (warning)',
};

export default function ChargebacksPage() {
  const [data, setData] = useState<{
    chargebacks: Chargeback[];
    counts: Record<string, number>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    async function load(): Promise<void> {
      try {
        const res = await authFetch('/api/admin/chargebacks');
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
      <div className="p-6">
        <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          {error}
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="p-6 text-sm text-muted-foreground">Načítání…</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Chargebacks"
        description="Spory z platebních karet (Stripe disputes). Odpověz na needs_response do 7 dní jinak Stripe rozhodne automaticky."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <div key={key} className={`rounded-md border p-3 ${STATUS_COLORS[key] ?? ''}`}>
            <div className="text-xs uppercase opacity-70">{label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              {data.counts[key] ?? 0}
            </div>
          </div>
        ))}
      </div>

      {data.chargebacks.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Žádné chargebacks. 👌
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Datum</th>
                <th className="px-3 py-2">Akce</th>
                <th className="px-3 py-2">Kupec</th>
                <th className="px-3 py-2 text-right">Částka</th>
                <th className="px-3 py-2">Důvod</th>
                <th className="px-3 py-2">Stav</th>
                <th className="px-3 py-2">Holdback</th>
              </tr>
            </thead>
            <tbody>
              {data.chargebacks.map((cb) => (
                <tr key={cb.id} className="border-t">
                  <td className="px-3 py-2 text-xs">
                    {new Date(cb.created_at).toLocaleDateString('cs-CZ')}
                  </td>
                  <td className="px-3 py-2">{cb.event_title ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">{cb.buyer_email ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCzk(cb.amount_halire)}
                  </td>
                  <td className="px-3 py-2 text-xs">{cb.reason ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[cb.status] ?? ''}`}>
                      {STATUS_LABELS[cb.status] ?? cb.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {cb.holdback_applied ? (
                      <span className="text-rose-700">✓ Strženo</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Card>
        <CardContent className="p-4 text-xs">
          <strong>Co s tím?</strong>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              <strong>needs_response</strong>: zákazník zpochybnil platbu v bance.
              Máš 7 dní na poskytnutí důkazů (vstupenka, scan, kontakt). Pošli
              je přes Stripe dashboard.
            </li>
            <li>
              <strong>under_review</strong>: důkazy odeslány, Stripe rozhoduje.
            </li>
            <li>
              <strong>lost</strong>: bance se nepodařilo platbu obhájit. Částka
              se odečte z příštího payoutu (sloupec Holdback).
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
