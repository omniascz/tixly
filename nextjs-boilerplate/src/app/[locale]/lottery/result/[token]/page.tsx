'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface EntryData {
  entry: {
    id: string;
    status: string;
    email: string;
    paymentDeadline: string | null;
  };
  event: {
    id: string;
    title: string;
    date: string | null;
  };
  campaignId: string;
  campaignDrawAt: string;
}

function Countdown({ deadline }: { deadline: string }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    function update() {
      const ms = new Date(deadline).getTime() - Date.now();
      if (ms <= 0) {
        setRemaining('Vypršela');
        return;
      }
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1_000);
      setRemaining(`${h}h ${m}m ${s}s`);
    }
    update();
    const id = setInterval(update, 1_000);
    return () => clearInterval(id);
  }, [deadline]);

  return <span className="font-mono font-semibold">{remaining}</span>;
}

export default function LotteryResultPage() {
  const params = useParams();
  const router = useRouter();
  const token = String(params.token);
  const locale = String(params.locale ?? 'cs');

  const [data, setData] = useState<EntryData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const res = await fetch(`/api/lottery/entry/${encodeURIComponent(token)}`);
        if (!res.ok) {
          setLoadError(`HTTP ${res.status}`);
          return;
        }
        setData(await res.json());
      } catch (e) {
        setLoadError((e as Error).message);
      }
    }
  }, [token]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-md py-12">
        <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          {loadError}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-md py-12 text-center text-sm text-muted-foreground">
        Načítám…
      </div>
    );
  }

  const { entry, event, campaignDrawAt } = data;
  const drawDate = new Date(campaignDrawAt).toLocaleString(locale === 'sk' ? 'sk-SK' : 'cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (entry.status === 'won') {
    const checkoutUrl = `/${locale}/checkout?eventId=${event.id}&ticketTypeId=&lotteryEntryId=${entry.id}&lotteryToken=${token}`;
    const deadlineStr = entry.paymentDeadline
      ? new Date(entry.paymentDeadline).toLocaleString(locale === 'sk' ? 'sk-SK' : 'cs-CZ', {
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

    return (
      <div className="mx-auto max-w-md py-12">
        <Card className="border-emerald-300">
          <CardHeader>
            <div className="text-center text-4xl">🎉</div>
            <CardTitle className="text-center text-emerald-800">Vyhráli jste!</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
              <p className="font-semibold">{event.title}</p>
              {event.date ? (
                <p className="text-xs text-muted-foreground">
                  {new Date(event.date).toLocaleDateString(locale === 'sk' ? 'sk-SK' : 'cs-CZ', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              ) : null}
              <p className="mt-1 text-emerald-700">Vstupenka na {event.title} čeká na vás.</p>
            </div>
            {entry.paymentDeadline ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Platební lhůta:</p>
                <p className="mt-0.5">{deadlineStr}</p>
                <p className="mt-1">
                  Zbývá: <Countdown deadline={entry.paymentDeadline} />
                </p>
              </div>
            ) : null}
            <Button
              className="w-full"
              onClick={() => router.push(checkoutUrl)}
            >
              Koupit vstupenku
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Pokud nezaplatíte včas, slot připadne dalšímu zájemci.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (entry.status === 'lost') {
    return (
      <div className="mx-auto max-w-md py-12">
        <Card>
          <CardHeader>
            <div className="text-center text-3xl">😔</div>
            <CardTitle className="text-center">Tentokrát to nevyšlo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Tentokrát se vám losování nepodařilo. Sledujte nás pro další příležitosti.</p>
            <Link
              href={`/${locale}/events/${event.id}/waitlist`}
              className="block rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-center text-sm font-medium text-primary hover:bg-primary/10"
            >
              Přidat se na čekací listinu pro tuto akci
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (entry.status === 'entered') {
    return (
      <div className="mx-auto max-w-md py-12">
        <Card>
          <CardHeader>
            <div className="text-center text-3xl">⏳</div>
            <CardTitle className="text-center">Jste zapsáni</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Losování proběhne {drawDate}.</p>
            <p>Výsledek pošleme emailem na {entry.email}.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (entry.status === 'converted') {
    return (
      <div className="mx-auto max-w-md py-12">
        <Card className="border-emerald-300">
          <CardHeader>
            <div className="text-center text-3xl">✅</div>
            <CardTitle className="text-center">Vstupenka zakoupena</CardTitle>
          </CardHeader>
          <CardContent className="text-center text-sm">
            <p className="text-muted-foreground">Vaše vstupenka je zakoupena.</p>
            <Link
              href={`/${locale}/my-tickets`}
              className="mt-3 block text-primary underline"
            >
              Přejít na Moje vstupenky
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (entry.status === 'expired') {
    return (
      <div className="mx-auto max-w-md py-12">
        <Card>
          <CardHeader>
            <div className="text-center text-3xl">⌛</div>
            <CardTitle className="text-center text-rose-700">Platební lhůta vypršela</CardTitle>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            <p>Omlouváme se, platební lhůta pro vaši výhru vypršela.</p>
            <Link
              href={`/${locale}/events/${event.id}`}
              className="mt-3 block text-primary underline"
            >
              Zpět na akci
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-12">
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Status: {entry.status}
        </CardContent>
      </Card>
    </div>
  );
}
