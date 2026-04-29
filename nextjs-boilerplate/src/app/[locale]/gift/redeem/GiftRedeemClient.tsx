'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

interface GiftDetail {
  status: 'pending' | 'redeemed';
  eventTitle: string;
  eventDateStart: string;
  fromBuyerEmail: string;
  recipientName: string | null;
  message: string | null;
  orderStatus: string;
}

export function GiftRedeemClient({ token, locale }: { token: string; locale: string }) {
  const [data, setData] = useState<GiftDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const res = await fetch(`/api/gift/redeem?token=${encodeURIComponent(token)}`);
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        setData((await res.json()) as GiftDetail);
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [token]);

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/gift/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setDone(true);
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
  if (data.status === 'redeemed') {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        Dárek byl už uplatněn.
      </div>
    );
  }
  if (data.orderStatus !== 'paid' && data.orderStatus !== 'paid_partial') {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        Dárek ještě není zaplacen kupcem ({data.orderStatus}).
      </div>
    );
  }
  if (done) {
    return (
      <div className="space-y-3 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p>Dárek úspěšně přijat! Lístky jsou nyní tvoje.</p>
        <a
          href={`/${locale}/my-tickets`}
          className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Moje lístky →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-6">
      <div className="text-center">
        <div className="text-3xl">🎁</div>
        <h2 className="mt-2 text-xl font-bold">
          {data.recipientName ? `${data.recipientName}, máš dárek!` : 'Máš dárek!'}
        </h2>
      </div>
      <div className="rounded-md bg-muted/40 p-3 text-sm">
        <div className="font-medium">{data.eventTitle}</div>
        <div className="text-xs text-muted-foreground">
          {new Date(data.eventDateStart).toLocaleString('cs-CZ', {
            dateStyle: 'long',
            timeStyle: 'short',
          })}
        </div>
        <div className="mt-2 text-xs">Od: {data.fromBuyerEmail}</div>
      </div>
      {data.message ? (
        <div className="rounded-md border border-pink-200 bg-pink-50 p-3 text-sm italic text-pink-900">
          „{data.message}"
        </div>
      ) : null}
      <Button onClick={claim} disabled={busy} className="w-full">
        {busy ? 'Přijímám…' : 'Přijmout dárek'}
      </Button>
    </div>
  );
}
