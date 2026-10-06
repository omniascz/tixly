'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';

interface EntryDetail {
  id: string;
  email: string;
  name: string | null;
  eventId: string;
  eventTitle: string;
  ticketTypeId: string;
  ticketTypeName: string;
  ticketTypePrice: number;
  quantity: number;
  redeemDeadline: string;
}

export function LotteryRedeemClient({ token, locale }: { token: string; locale: string }) {
  const [data, setData] = useState<{ status: string; entry?: EntryDetail; message?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const res = await fetch(`/api/lottery/redeem?token=${encodeURIComponent(token)}`);
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        setData(await res.json());
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [token]);

  async function proceed() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/lottery/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        checkoutPayload?: {
          eventId: string;
          ticketTypeId: string;
          quantity: number;
          buyerEmail: string;
          buyerName: string;
          lotteryEntryId: string;
        };
      };
      if (!res.ok || !j.checkoutPayload) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      const params = new URLSearchParams({
        eventId: j.checkoutPayload.eventId,
        ticketTypeId: j.checkoutPayload.ticketTypeId,
        quantity: String(j.checkoutPayload.quantity),
        buyerEmail: j.checkoutPayload.buyerEmail,
        buyerName: j.checkoutPayload.buyerName,
        lotteryEntryId: j.checkoutPayload.lotteryEntryId,
      });
      window.location.href = `/${locale}/checkout?${params.toString()}`;
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
        {error}
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Načítání…</p>;
  }
  if (data.status !== 'winner' || !data.entry) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        {data.message ?? `Status: ${data.status}`}
      </div>
    );
  }

  const e = data.entry;
  const total = e.ticketTypePrice * e.quantity;
  const deadlineDate = new Date(e.redeemDeadline);
  const hoursLeft = Math.max(0, Math.floor((deadlineDate.getTime() - Date.now()) / 3_600_000));

  return (
    <div className="space-y-4 rounded-lg border bg-card p-6">
      <div className="text-center">
        <div className="text-3xl">🎉</div>
        <h2 className="mt-2 text-xl font-bold">Vyhrál/a jsi v losování!</h2>
      </div>
      <div className="rounded-md bg-muted/40 p-3 text-sm">
        <div className="font-medium">{e.eventTitle}</div>
        <div className="text-xs text-muted-foreground">{e.ticketTypeName}</div>
        <div className="mt-2 flex justify-between">
          <span>{e.quantity}× lístek</span>
          <span className="font-medium">{formatMoney(total, 'CZK')}</span>
        </div>
      </div>
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
        <strong>Deadline:</strong> {deadlineDate.toLocaleString('cs-CZ')}{' '}
        ({hoursLeft}h zbývá) — pokud nezaplatíš, slot půjde dalšímu losovanému.
      </div>
      <Button onClick={proceed} disabled={busy} className="w-full">
        {busy ? 'Přesměrovávám…' : 'Pokračovat k objednávce'}
      </Button>
    </div>
  );
}
