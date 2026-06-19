'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

interface EventInfo {
  id: string;
  name: string;
  date_start: string;
  venue_name: string | null;
  press_seats_max: number;
  press_deadline: string | null;
  status: string;
}

type Phase = 'loading' | 'form' | 'success' | 'closed' | 'error';

export default function PressAccreditationPage() {
  const params = useParams<{ locale: string; eventId: string }>();
  const eventId = params.eventId;

  const [phase, setPhase] = useState<Phase>('loading');
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [outlet, setOutlet] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load(): Promise<void> {
    try {
      const res = await fetch(`/api/press/event/${eventId}`);
      if (!res.ok) {
        setPhase('error');
        setLoadError(`HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as { event?: EventInfo };
      const ev = j.event;
      if (!ev) {
        setPhase('error');
        setLoadError('Akce nenalezena.');
        return;
      }
      setEvent(ev);

      if (ev.status !== 'published') {
        setPhase('closed');
        return;
      }
      if (ev.press_deadline && new Date(ev.press_deadline) < new Date()) {
        setPhase('closed');
        return;
      }
      setPhase('form');
    } catch (e) {
      setPhase('error');
      setLoadError((e as Error).message);
    }
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/press/accreditation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          journalistName: name.trim(),
          journalistEmail: email.trim(),
          mediaOutlet: outlet.trim(),
          purpose: purpose.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };

      if (!res.ok) {
        const msg: Record<string, string> = {
          ALREADY_APPLIED: 'Z tohoto e-mailu již byla žádost podána.',
          ACCREDITATION_CLOSED: 'Akreditace pro tuto akci jsou uzavřeny.',
          ACCREDITATION_FULL: 'Akreditace pro tuto akci jsou uzavřeny.',
          DEADLINE_PASSED: 'Termín pro podání žádostí již uplynul.',
        };
        setFormError(msg[j.error ?? ''] ?? `Chyba: ${j.error ?? res.status}`);
        return;
      }
      setPhase('success');
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'loading') {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <XCircle className="mx-auto mb-3 h-10 w-10 text-rose-500" />
        <p className="font-medium text-rose-700">{loadError ?? 'Chyba při načítání.'}</p>
      </div>
    );
  }

  if (phase === 'closed') {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <XCircle className="mx-auto mb-3 h-10 w-10 text-slate-400" />
        <h1 className="mb-2 text-xl font-semibold">{event?.name}</h1>
        <p className="text-muted-foreground">Akreditace pro tuto akci jsou uzavřeny.</p>
      </div>
    );
  }

  if (phase === 'success') {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
        <h1 className="mb-2 text-xl font-semibold">Žádost přijata</h1>
        <p className="text-muted-foreground">Vaše žádost byla přijata. Vyrozumíme vás do 48 hodin.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold">{event?.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {event?.date_start
            ? new Date(event.date_start).toLocaleString('cs-CZ', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : null}
          {event?.venue_name ? ` · ${event.venue_name}` : null}
        </p>
        {event?.press_deadline ? (
          <p className="mt-1 text-sm text-amber-700">
            Deadline pro žádosti:{' '}
            {new Date(event.press_deadline).toLocaleString('cs-CZ', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Žádost o press akreditaci</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void submit(e)} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Jméno a příjmení *</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jana Nováková"
                required
                maxLength={200}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">E-mail *</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jana@redakce.cz"
                required
                maxLength={200}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Médium / Redakce *</label>
              <Input
                value={outlet}
                onChange={(e) => setOutlet(e.target.value)}
                placeholder="Hospodářské noviny"
                required
                maxLength={200}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Účel návštěvy</label>
              <textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Recenze, reportáž, rozhovor..."
                maxLength={1000}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {formError ? (
              <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
                {formError}
              </div>
            ) : null}

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Odesílám...
                </>
              ) : (
                'Odeslat žádost o akreditaci'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
