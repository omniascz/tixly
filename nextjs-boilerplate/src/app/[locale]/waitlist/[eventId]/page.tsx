'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Clock, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface EventInfo {
  title: string;
  date_start: string;
}

interface WaitlistInfo {
  totalWaiting: number;
}

type Phase = 'loading' | 'form' | 'success' | 'error';

export default function WaitlistPage() {
  const params = useParams<{ locale: string; eventId: string }>();
  const eventId = params.eventId;

  const [phase, setPhase] = useState<Phase>('loading');
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [waitlistInfo, setWaitlistInfo] = useState<WaitlistInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [position, setPosition] = useState<number | null>(null);
  const [waitlistId, setWaitlistId] = useState<string | null>(null);

  useEffect(() => {
    void load();

    async function load() {
      try {
        const [evRes, wlRes] = await Promise.all([
          fetch(`/api/events/${eventId}`),
          fetch(`/api/events/${eventId}/waitlist`),
        ]);
        if (evRes.ok) {
          const j = (await evRes.json()) as { event?: EventInfo; title?: string; date_start?: string };
          setEvent(j.event ?? (j as EventInfo));
        }
        if (wlRes.ok) {
          setWaitlistInfo((await wlRes.json()) as WaitlistInfo);
        }
        setPhase('form');
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'Chyba při načítání');
        setPhase('error');
      }
    }
  }, [eventId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: name || undefined }),
      });
      const json = (await res.json()) as {
        waitlistId?: string;
        position?: number;
        error?: string;
      };
      if (!res.ok) {
        setFormError(json.error ?? `Chyba ${res.status}`);
        return;
      }
      setPosition(json.position ?? null);
      setWaitlistId(json.waitlistId ?? null);
      setPhase('success');
    } finally {
      setBusy(false);
    }
  }

  async function handleUnsubscribe() {
    if (!waitlistId || !email) return;
    const res = await fetch(
      `/api/events/${eventId}/waitlist?email=${encodeURIComponent(email)}&token=${encodeURIComponent(waitlistId)}`,
      { method: 'DELETE' },
    );
    if (res.ok) {
      setPhase('form');
      setPosition(null);
      setWaitlistId(null);
      setEmail('');
      setName('');
    }
  }

  const eventTitle = event?.title ?? 'Akce';
  const eventDate = event?.date_start
    ? new Date(event.date_start).toLocaleDateString('cs-CZ', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  if (phase === 'loading') {
    return (
      <div className="mx-auto max-w-md py-8">
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Načítám…
          </CardContent>
        </Card>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="mx-auto max-w-md py-8">
        <Card>
          <CardContent className="py-6 text-sm text-rose-700">
            {loadError ?? 'Nepodařilo se načíst akci.'}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (phase === 'success') {
    return (
      <div className="mx-auto max-w-md py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" aria-hidden />
              Zapsáni na čekací listinu
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p>
              Jste na místě <strong>{position}</strong>. Dáme vám vědět, jakmile se místo uvolní.
            </p>
            <p className="text-muted-foreground">
              Přijde vám e-mail na <strong>{email}</strong>.
            </p>
            {waitlistId ? (
              <button
                type="button"
                onClick={() => void handleUnsubscribe()}
                className="text-xs text-muted-foreground underline"
              >
                Odhlásit se z čekací listiny
              </button>
            ) : null}
            <div className="pt-2">
              <Link href="/" className="text-xs text-primary underline">
                Zpět na hlavní stránku
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-8">
      <Card>
        <CardHeader>
          <CardTitle>{eventTitle}</CardTitle>
          {eventDate ? (
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" aria-hidden />
              {eventDate}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
            Akce je vyprodána — zapište se na čekací listinu.
            {waitlistInfo && waitlistInfo.totalWaiting > 0 ? (
              <span className="ml-1">
                Aktuálně čeká {waitlistInfo.totalWaiting}{' '}
                {waitlistInfo.totalWaiting === 1
                  ? 'zájemce'
                  : waitlistInfo.totalWaiting < 5
                  ? 'zájemci'
                  : 'zájemců'}
                .
              </span>
            ) : null}
          </div>

          {formError ? (
            <div className="rounded-md bg-rose-50 border border-rose-200 p-3 text-sm text-rose-900">
              {formError}
            </div>
          ) : null}

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="wl-name">
                Jméno
              </label>
              <Input
                id="wl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jana Novák"
                disabled={busy}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="wl-email">
                E-mail <span className="text-rose-500">*</span>
              </label>
              <Input
                id="wl-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jana@example.com"
                disabled={busy}
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Ukládám…
                </>
              ) : (
                'Zapsat se na čekací listinu'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
