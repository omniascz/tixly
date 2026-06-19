'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface CampaignInfo {
  id: string;
  status: string;
  max_winners: number;
  registration_closes: string;
  draw_at: string;
  entry_count: number;
  event_title: string;
  event_date: string | null;
}

export default function LotteryRegistrationPage() {
  const params = useParams();
  const campaignId = String(params.campaignId);
  const locale = String(params.locale ?? 'cs');

  const [campaign, setCampaign] = useState<CampaignInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [registered, setRegistered] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<number | null>(null);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const r = await fetch(`/api/lottery/${campaignId}/enter`, { method: 'HEAD' }).catch(() => null);
        const info = await fetch(`/api/lottery/entry/campaign/${campaignId}`).catch(() => null);
        if (info && info.ok) {
          setCampaign(await info.json());
          return;
        }
        const fallback = await fetch(`/api/lottery/${campaignId}/info`).catch(() => null);
        if (fallback && fallback.ok) {
          setCampaign(await fallback.json());
          return;
        }
        void r;
      } catch (e) {
        setLoadError((e as Error).message);
      }
    }
  }, [campaignId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setRegError(null);
    try {
      const res = await fetch(`/api/lottery/${campaignId}/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        position?: number;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        setRegError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      setRegistered(true);
      setPosition(j.position ?? null);
    } catch {
      setRegError('Síťová chyba');
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-md py-12">
        <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          {loadError}
        </div>
      </div>
    );
  }

  const isClosed = campaign && (
    campaign.status === 'closed' ||
    campaign.status === 'drawn' ||
    campaign.status === 'completed' ||
    new Date(campaign.registration_closes).getTime() <= Date.now()
  );

  const drawDate = campaign
    ? new Date(campaign.draw_at).toLocaleString(locale === 'sk' ? 'sk-SK' : 'cs-CZ', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return (
    <div className="mx-auto max-w-md py-12">
      <Card>
        <CardHeader>
          <CardTitle>
            {campaign?.event_title ?? 'Losování vstupenek'}
          </CardTitle>
          {campaign?.event_date ? (
            <CardDescription>
              {new Date(campaign.event_date).toLocaleDateString(locale === 'sk' ? 'sk-SK' : 'cs-CZ', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Vstupenky jsou nedostatkové — registrujte zájem o losování.
            {campaign ? (
              <span className="ml-1">
                K dispozici {campaign.max_winners} {campaign.max_winners === 1 ? 'vstupenka' : campaign.max_winners < 5 ? 'vstupenky' : 'vstupenek'}.
              </span>
            ) : null}
          </div>

          {campaign ? (
            <div className="text-sm text-muted-foreground">
              Aktuálně zapsáno:{' '}
              <span className="font-semibold text-foreground">
                {campaign.entry_count} zájemců
              </span>
            </div>
          ) : null}

          {registered ? (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
              <p className="font-semibold">Jste zapsáni!</p>
              {position ? <p className="mt-1">Vaše pořadové číslo: {position}.</p> : null}
              <p className="mt-1">Losování: {drawDate}.</p>
              <p className="mt-1">Výsledek pošleme na {email}.</p>
            </div>
          ) : isClosed ? (
            <div className="rounded-md border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
              {campaign?.status === 'completed'
                ? 'Losování je dokončeno.'
                : 'Registrace uzavřena.'}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label htmlFor="lottery-name" className="mb-1 block text-xs font-medium">
                  Jméno a příjmení
                </label>
                <Input
                  id="lottery-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
              <div>
                <label htmlFor="lottery-email" className="mb-1 block text-xs font-medium">
                  E-mail
                </label>
                <Input
                  id="lottery-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              {regError ? (
                <p className="text-sm text-destructive">{regError}</p>
              ) : null}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Zapisuji…' : 'Zaregistrovat zájem'}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Losování proběhne {drawDate}.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
