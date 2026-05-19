'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Mail, Send, CheckCircle2, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface EventOption {
  id: string;
  title: string;
  dateStart: string;
  ticketTypes: { id: string; name: string; basePrice: number }[];
}

interface Broadcast {
  id: string;
  eventId: string;
  eventTitle: string;
  subject: string;
  filter: string;
  recipientsCount: number;
  sentCount: number;
  failedCount: number;
  status: 'sending' | 'completed' | 'failed';
  createdAt: string;
  completedAt: string | null;
}

const FILTER_LABELS: Record<string, string> = {
  followers: 'Followers (newsletter)',
  all_buyers: 'Všichni kupci',
  paid_only: 'Jen zaplacení',
  ticket_type: 'Konkrétní typ lístku',
  waitlist: 'Čekací listina',
};

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function BroadcastsPage() {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);

  // Form
  const [eventId, setEventId] = useState('');
  const [filter, setFilter] = useState<'all_buyers' | 'paid_only' | 'ticket_type' | 'waitlist'>(
    'paid_only',
  );
  const [ticketTypeId, setTicketTypeId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const [evRes, bRes] = await Promise.all([
        authFetch('/api/admin/pos/events'),
        authFetch('/api/admin/broadcasts'),
      ]);
      if (evRes.ok) {
        const data = (await evRes.json()) as { events: EventOption[] };
        setEvents(data.events ?? []);
      }
      if (bRes.ok) {
        const data = (await bRes.json()) as { broadcasts: Broadcast[] };
        setBroadcasts(data.broadcasts ?? []);
      }
    } catch {
      // ignore
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await authFetch('/api/admin/broadcasts', {
        method: 'POST',
        body: JSON.stringify({
          eventId,
          subject,
          body,
          filter,
          ticketTypeId: filter === 'ticket_type' ? ticketTypeId : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(`Odesláno ${data.recipientsCount} příjemcům.`);
      setSubject('');
      setBody('');
      // Reload za 2s aby se ukázal updated status
      setTimeout(() => void load(), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Síťová chyba');
    } finally {
      setBusy(false);
    }
  }

  const event = events.find((e) => e.id === eventId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Newsletter / Broadcasts"
        description="Pošli hromadný e-mail kupcům konkrétního představení — připomínka, změna programu, slevový kód."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" aria-hidden /> Nová zpráva
            </CardTitle>
            <CardDescription>
              Vyber představení a segment publika. Odesláno přes Tixly mail —
              příjemce uvidí jako odesílatele <strong>{`{tvůj brand}`}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label htmlFor="br-event" className="mb-1 block text-xs font-medium">
                  Představení
                </label>
                <select
                  id="br-event"
                  value={eventId}
                  onChange={(e) => {
                    setEventId(e.target.value);
                    setTicketTypeId('');
                  }}
                  required
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— vyber představení —</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title} ({new Date(ev.dateStart).toLocaleDateString('cs-CZ')})
                    </option>
                  ))}
                </select>
              </div>

              <fieldset className="border-0 p-0">
                <legend className="mb-1 block text-xs font-medium">Komu poslat</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(FILTER_LABELS)).map((f) => (
                    <label
                      key={f}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${filter === f ? 'border-primary bg-primary/5' : ''}`}
                    >
                      <input
                        type="radio"
                        name="filter"
                        value={f}
                        checked={filter === f}
                        onChange={() => setFilter(f as typeof filter)}
                      />
                      <span>{FILTER_LABELS[f]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {filter === 'ticket_type' && event ? (
                <div>
                  <label htmlFor="br-tt" className="mb-1 block text-xs font-medium">
                    Typ lístku
                  </label>
                  <select
                    id="br-tt"
                    value={ticketTypeId}
                    onChange={(e) => setTicketTypeId(e.target.value)}
                    required
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">— vyber typ —</option>
                    {event.ticketTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div>
                <label htmlFor="br-subj" className="mb-1 block text-xs font-medium">
                  Předmět
                </label>
                <Input
                  id="br-subj"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Připomínka: Eddie & Vanessa zítra v 19:30"
                  maxLength={200}
                  required
                />
              </div>

              <div>
                <label htmlFor="br-body" className="mb-1 block text-xs font-medium">
                  Text zprávy
                </label>
                <textarea
                  id="br-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={8}
                  required
                  minLength={10}
                  maxLength={10000}
                  placeholder={
                    `Milí přátelé,\n\npřipomínáme, že zítra ve 19:30 se těšíme na ` +
                    `setkání v Hlavním sále Divadla v Celetné. Doporučujeme dorazit\n` +
                    `aspoň 20 minut před začátkem — bar Verze otvíráme již v 19:00.\n\n` +
                    `Hezky se mějte,\nDivadlo Verze`
                  }
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Nové řádky se převedou na odstavce, HTML se neprovádí. {body.length}/10000
                </p>
              </div>

              {error ? (
                <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden />
                  {error}
                </div>
              ) : null}
              {success ? (
                <div className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900">
                  <CheckCircle2 className="mt-0.5 h-4 w-4" aria-hidden />
                  {success}
                </div>
              ) : null}

              <Button type="submit" disabled={busy || !eventId || !subject || !body}>
                {busy ? 'Odesílám…' : (
                  <>
                    <Send className="mr-2 h-4 w-4" aria-hidden /> Poslat
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Historie odeslaných ({broadcasts.length})</CardTitle>
            <CardDescription>Poslední broadcasty s počtem příjemců a doručením.</CardDescription>
          </CardHeader>
          <CardContent>
            {broadcasts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Žádné broadcasty zatím. Pošli první nalevo.
              </p>
            ) : (
              <ul className="space-y-2">
                {broadcasts.map((b) => (
                  <li key={b.id} className="rounded-md border p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{b.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {b.eventTitle} · {FILTER_LABELS[b.filter] ?? b.filter}
                        </p>
                        <p className="mt-1 text-xs">
                          {b.sentCount} / {b.recipientsCount} doručeno
                          {b.failedCount > 0 ? (
                            <span className="text-rose-700"> ({b.failedCount} selhalo)</span>
                          ) : null}
                          {' · '}
                          {new Date(b.createdAt).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' })}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          b.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-900'
                            : b.status === 'failed'
                              ? 'bg-rose-100 text-rose-900'
                              : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {b.status === 'completed' ? 'odesláno' : b.status === 'failed' ? 'selhalo' : 'odesílá se'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
