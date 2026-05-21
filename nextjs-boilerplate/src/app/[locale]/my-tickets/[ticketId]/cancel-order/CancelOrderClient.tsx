'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

function fmt(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

export function CancelOrderClient({ ticketId, locale }: { ticketId: string; locale: string }): JSX.Element {
  const [orderId, setOrderId] = useState<string | null>(null);
  const [eventTitle, setEventTitle] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<{
    refundAmount: number;
    refundPct: number;
    beforeDeadline: boolean;
    message: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch('/api/buyer/my-tickets')
      .then((r) => r.json())
      .then((d: { tickets: Array<{ id: string; order_id: string; event_title: string }> }) => {
        const t = d.tickets.find((x) => x.id === ticketId);
        if (t) {
          setOrderId(t.order_id);
          setEventTitle(t.event_title);
        } else {
          setError('Lístek nenalezen.');
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Chyba'));
  }, [ticketId]);

  async function submit(): Promise<void> {
    if (!orderId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await authFetch(`/api/buyer/orders/${orderId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || undefined }),
      });
      const data = await r.json() as Record<string, unknown>;
      if (!r.ok) throw new Error((data.error as string) ?? `HTTP ${r.status}`);
      setResult({
        refundAmount: data.refundAmount as number,
        refundPct: data.refundPct as number,
        beforeDeadline: data.beforeDeadline as boolean,
        message: data.message as string,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-emerald-900">
            <Check className="h-5 w-5" /> Objednávka zrušena
          </div>
          <p className="mt-2 text-emerald-800">{result.message}</p>
          {result.refundAmount > 0 ? (
            <p className="mt-2">
              Refund: <strong>{fmt(result.refundAmount)}</strong> ({result.refundPct} %)
              {result.beforeDeadline ? ' — před deadline' : ' — po deadline'}
            </p>
          ) : null}
        </div>
        <Link href={`/${locale}/my-tickets`} className="text-sm text-primary hover:underline">
          ← Zpět na moje lístky
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link
        href={`/${locale}/my-tickets`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-3 w-3" /> Zpět
      </Link>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      ) : null}

      {eventTitle ? (
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">Objednávka pro</p>
          <p className="font-semibold">{eventTitle}</p>
        </div>
      ) : null}

      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <div className="flex gap-2">
          <AlertTriangle className="h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Toto nelze vrátit zpět</p>
            <p className="mt-1 text-xs">
              Všechny lístky této objednávky se zneplatní. Pokud chceš jen některý lístek
              předat, použij funkci „Přeposlat" v seznamu lístků.
            </p>
          </div>
        </div>
      </div>

      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Důvod zrušení (volitelně, pomáhá pořadateli pochopit)"
        maxLength={500}
        rows={3}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="h-4 w-4"
        />
        <span>Rozumím, že tímto se mé lístky zneplatní a refund závisí na deadline pořadatele.</span>
      </label>

      <Button
        onClick={submit}
        disabled={busy || !confirmed || !orderId}
        variant="destructive"
        className="w-full"
      >
        {busy ? 'Zpracovávám…' : 'Definitivně zrušit objednávku'}
      </Button>
    </div>
  );
}
