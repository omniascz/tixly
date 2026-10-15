'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface EventOption {
  id: string;
  title: string;
  dateStart: string;
  remainingQty: number;
}

interface GiftDetail {
  recipientName: string | null;
  giftMessage: string | null;
  fromName: string | null;
  eventTitle: string;
  eventDateStart: string;
  expiresAt: string;
  hasChoice: boolean;
  options: EventOption[];
}

interface ClaimResult {
  ticket: { id: string; eventTitle: string; eventDate: string };
  qrPayload: string;
}

function QRDisplay({ payload }: { payload: string }) {
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);

  // qrPayload je platná vstupenka — QR generujeme lokálně v prohlížeči, nikdy ne přes externí službu.
  useEffect(() => {
    let cancelled = false;
    const size = 220;
    QRCode.toDataURL(payload, { width: size, margin: 4 })
      .then((url) => {
        if (!cancelled) setQrSrc(url);
      })
      .catch(() => {
        if (!cancelled) setQrFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  if (qrFailed) return null;
  if (!qrSrc) return <div className="h-[220px] w-[220px] animate-pulse rounded-lg bg-muted" />;
  return (
    <img
      src={qrSrc}
      alt="Vstupenka QR"
      width={220}
      height={220}
      className="rounded-lg border shadow-sm"
    />
  );
}

export default function GiftTokenPage() {
  const params = useParams();
  const token = String(params.token);
  const locale = String(params.locale ?? 'cs');

  const [gift, setGift] = useState<GiftDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState<ClaimResult | null>(null);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const res = await fetch(`/api/gift/${encodeURIComponent(token)}`);
        const data = (await res.json()) as { gift?: GiftDetail; error?: string };
        if (!res.ok || data.error) {
          const msgs: Record<string, string> = {
            GIFT_NOT_FOUND: 'Tento dárkový odkaz neexistuje nebo vypršel.',
            ALREADY_CLAIMED: 'Tenhle dárek byl už uplatněn.',
            ORDER_NOT_PAID: 'Dárce ještě nedokončil platbu. Zkus to znovu za chvíli.',
          };
          setError(msgs[data.error ?? ''] ?? `Chyba: ${data.error ?? res.status}`);
          return;
        }
        if (data.gift) {
          setGift(data.gift);
          if (!data.gift.hasChoice && data.gift.options.length === 0) {
            setSelectedEventId(null);
          }
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [token]);

  async function handleClaim() {
    if (!gift) return;
    const eventId = selectedEventId ?? (gift.hasChoice ? null : null);
    if (gift.hasChoice && !eventId) {
      setError('Vyber termín před uplatněním.');
      return;
    }
    const chosenEventId = eventId ?? gift.options[0]?.id;
    if (!chosenEventId) {
      setError('Žádný dostupný termín.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/gift/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedEventId: chosenEventId }),
      });
      const data = (await res.json()) as ClaimResult & { error?: string };
      if (!res.ok || data.error) {
        const msgs: Record<string, string> = {
          ALREADY_CLAIMED: 'Dárek byl mezitím uplatněn.',
          NO_TICKETS_AVAILABLE: 'Na tento termín již nejsou vstupenky. Zvol jiný.',
          GIFT_EXPIRED: 'Platnost dárku vypršela.',
        };
        setError(msgs[data.error ?? ''] ?? `Chyba: ${data.error ?? res.status}`);
        return;
      }
      setClaimed(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !gift) {
    return (
      <div className="mx-auto max-w-md py-16 px-4 text-center">
        <div className="text-5xl mb-4">😔</div>
        <p className="text-lg text-rose-700 font-medium">{error}</p>
      </div>
    );
  }

  if (!gift) {
    return (
      <div className="mx-auto max-w-md py-16 px-4 text-center">
        <div className="h-8 w-48 mx-auto animate-pulse rounded bg-muted mb-4" />
        <div className="h-4 w-64 mx-auto animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (claimed) {
    return (
      <div className="mx-auto max-w-md py-12 px-4 space-y-6 text-center">
        <div className="text-6xl">🎉</div>
        <h1 className="text-2xl font-bold text-emerald-700">Vstupenka je tvoje!</h1>
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="py-4 space-y-1">
            <p className="font-semibold text-lg">{claimed.ticket.eventTitle}</p>
            <p className="text-sm text-muted-foreground">
              {new Date(claimed.ticket.eventDate).toLocaleString('cs-CZ', {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
            </p>
          </CardContent>
        </Card>
        <div className="flex justify-center">
          <QRDisplay payload={claimed.qrPayload} />
        </div>
        <p className="text-xs text-muted-foreground">
          Vstupenku najdeš také v sekci Moje lístky po přihlášení.
        </p>
        <a
          href={`/${locale}/my-tickets`}
          className="inline-block rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground"
        >
          Moje lístky
        </a>
      </div>
    );
  }

  const expiresDate = new Date(gift.expiresAt).toLocaleDateString('cs-CZ', { dateStyle: 'long' });

  return (
    <div className="mx-auto max-w-md py-12 px-4 space-y-6">
      <div className="text-center space-y-2">
        <div className="text-6xl">🎁</div>
        <h1 className="text-2xl font-bold">
          {gift.recipientName ? `${gift.recipientName}, máš dárek!` : 'Máš dárkovou vstupenku!'}
        </h1>
        <p className="text-sm text-muted-foreground">od {gift.fromName ?? 'dárce'}</p>
      </div>

      <Card className="border-pink-200 bg-gradient-to-br from-pink-50 to-rose-50">
        <CardContent className="py-5 space-y-3">
          <p className="font-semibold text-lg text-center">{gift.eventTitle}</p>
          {!gift.hasChoice && (
            <p className="text-sm text-center text-muted-foreground">
              {new Date(gift.eventDateStart).toLocaleString('cs-CZ', {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
            </p>
          )}
          {gift.giftMessage ? (
            <blockquote className="mt-3 border-l-4 border-pink-300 pl-3 text-sm italic text-pink-900">
              „{gift.giftMessage}"
            </blockquote>
          ) : null}
          <p className="text-xs text-muted-foreground text-center">Platí do {expiresDate}</p>
        </CardContent>
      </Card>

      {gift.hasChoice && gift.options.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Vyber termín:</p>
          <div className="space-y-2">
            {gift.options.map((ev) => (
              <button
                key={ev.id}
                onClick={() => setSelectedEventId(ev.id)}
                className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition-colors
                  ${selectedEventId === ev.id
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border bg-card hover:bg-muted/50'
                  }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {new Date(ev.dateStart).toLocaleString('cs-CZ', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'long',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <Badge variant="secondary" className="shrink-0">
                    {ev.remainingQty} zbývá
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : gift.hasChoice && gift.options.length === 0 ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-4 text-sm text-amber-800 text-center">
            Momentálně nejsou dostupné žádné termíny. Zkus to prosím později.
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      <Button
        className="w-full text-base py-5"
        onClick={() => void handleClaim()}
        disabled={busy || (gift.hasChoice && !selectedEventId) || (gift.hasChoice && gift.options.length === 0)}
      >
        {busy ? 'Zpracovávám…' : 'Uplatnit dárkový lístek'}
      </Button>
    </div>
  );
}
