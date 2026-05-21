'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CalendarX, AlertTriangle, Check } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedFetch, TypedFetchError } from '@/lib/typed-fetch';

interface EventInfo {
  id: string;
  title: string;
  date_start: string;
  date_end: string | null;
  status: string;
  postponed_at: string | null;
  postponed_reason: string | null;
  expected_decision_at: string | null;
  original_date_start: string | null;
  rescheduled_to_date: string | null;
}

export default function PostponePage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [reason, setReason] = useState('');
  const [rescheduledTo, setRescheduledTo] = useState('');
  const [expectedDecisionAt, setExpectedDecisionAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load(): Promise<void> {
    try {
      const data = await typedGet<{ event: EventInfo }>(`/api/admin/events/${eventId}`);
      setEvent(data.event);
    } catch (e) {
      // Fallback — fetch s minimálními poli
      setError(e instanceof Error ? e.message : 'Načítání failed');
    }
  }

  async function postpone(): Promise<void> {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await typedFetch(`/api/admin/events/${eventId}/postpone`, {
        method: 'POST',
        body: {
          reason,
          expectedDecisionAt: expectedDecisionAt || undefined,
          rescheduledTo: rescheduledTo || undefined,
        },
        throwOnError: true,
      });
      setSuccess(rescheduledTo ? 'Akce odložena s novým termínem.' : 'Akce odložena. Termín bude oznámen.');
      setReason('');
      setRescheduledTo('');
      setExpectedDecisionAt('');
      await load();
    } catch (err) {
      if (err instanceof TypedFetchError) {
        setError((err.body as { error?: string })?.error ?? `HTTP ${err.status}`);
      } else {
        setError(err instanceof Error ? err.message : 'Chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  async function unpostpone(): Promise<void> {
    if (!confirm('Vrátit akci do původního stavu? Buyer dostanou znovu notifikaci.')) return;
    setBusy(true);
    try {
      await typedFetch(`/api/admin/events/${eventId}/postpone`, { method: 'DELETE', throwOnError: true });
      setSuccess('Akce vrácena do původního stavu.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba');
    } finally {
      setBusy(false);
    }
  }

  if (!event) {
    return <div className="p-6 text-sm text-muted-foreground">{error ?? 'Načítám…'}</div>;
  }

  const isPostponed = event.postponed_at !== null;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Odložit akci"
        description="Postponed status — akce se odloží, tickety zůstávají platné. Buyer dostanou notifikaci."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      ) : null}
      {success ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          <Check className="h-4 w-4" /> {success}
        </div>
      ) : null}

      <Card className={isPostponed ? 'border-amber-400 bg-amber-50/30' : ''}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarX className="h-5 w-5" />
            {event.title}
          </CardTitle>
          <CardDescription>
            {isPostponed
              ? `🟠 ODLOŽENO od ${new Date(event.postponed_at!).toLocaleString('cs-CZ')}`
              : `Plánovaný termín: ${new Date(event.date_start).toLocaleString('cs-CZ')}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPostponed ? (
            <div className="space-y-2 text-sm">
              {event.original_date_start ? (
                <p>
                  Původní termín: <strong>{new Date(event.original_date_start).toLocaleString('cs-CZ')}</strong>
                </p>
              ) : null}
              {event.rescheduled_to_date ? (
                <p>
                  Nový termín: <strong className="text-emerald-700">
                    {new Date(event.rescheduled_to_date).toLocaleString('cs-CZ')}
                  </strong>
                </p>
              ) : null}
              {event.expected_decision_at ? (
                <p>
                  Rozhodnutí očekáváno: {new Date(event.expected_decision_at).toLocaleString('cs-CZ')}
                </p>
              ) : null}
              {event.postponed_reason ? (
                <p className="rounded-md bg-muted/30 p-3 text-xs">
                  Důvod: <em>{event.postponed_reason}</em>
                </p>
              ) : null}
              <Button onClick={unpostpone} variant="outline" disabled={busy} className="mt-3">
                Vrátit do původního stavu
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                <div className="flex gap-2">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-700" />
                  <div>
                    <p className="font-semibold text-amber-900">Postponed vs Cancelled</p>
                    <p className="mt-1 text-xs text-amber-800">
                      Postpone = tickety zůstávají platné, čeká se na nový termín nebo rozhodnutí.
                      Pokud chceš akci ZRUŠIT (a vrátit peníze), použij místo toho funkci Cancel.
                    </p>
                  </div>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Důvod odložení *</label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="např. nemoc umělce, počasí, technické problémy"
                  maxLength={1000}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Nový termín (volitelně)</label>
                  <Input
                    type="datetime-local"
                    value={rescheduledTo}
                    onChange={(e) => setRescheduledTo(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Očekávané rozhodnutí (volitelně)</label>
                  <Input
                    type="datetime-local"
                    value={expectedDecisionAt}
                    onChange={(e) => setExpectedDecisionAt(e.target.value)}
                  />
                </div>
              </div>
              <Button onClick={postpone} disabled={busy || !reason} variant="destructive">
                {busy ? 'Odkládám…' : '🟠 Odložit akci'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Po odložení automaticky pošleme broadcast e-mail všem buyerům.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
