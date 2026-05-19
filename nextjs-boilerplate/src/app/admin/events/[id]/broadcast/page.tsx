'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Broadcast {
  id: string;
  subject: string;
  filter: string;
  recipients_count: number;
  sent_count: number;
  failed_count: number;
  status: string;
  created_at: string;
  completed_at: string | null;
}

interface TicketType {
  id: string;
  name: string;
}

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

export default function BroadcastPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [history, setHistory] = useState<Broadcast[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Form
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [filter, setFilter] = useState<'paid_only' | 'all_buyers' | 'ticket_type' | 'waitlist'>(
    'paid_only',
  );
  const [ticketTypeId, setTicketTypeId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const [bRes, ttRes] = await Promise.all([
          authFetch(`/api/admin/events/${eventId}/broadcast`),
          authFetch(`/api/admin/events/${eventId}/sales-report`),
        ]);
        if (bRes.ok) {
          const j = (await bRes.json()) as { broadcasts: Broadcast[] };
          setHistory(j.broadcasts);
        }
        if (ttRes.ok) {
          const j = (await ttRes.json()) as {
            byTicketType: { ticketTypeId: string; name: string }[];
          };
          setTicketTypes(j.byTicketType.map((r) => ({ id: r.ticketTypeId, name: r.name })));
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [eventId]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!confirm(`Opravdu odeslat zprávu? Odešle se podle filtru "${filter}".`)) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/broadcast`, {
        method: 'POST',
        body: JSON.stringify({
          subject,
          body: bodyText,
          filter,
          ...(filter === 'ticket_type' ? { ticketTypeId } : {}),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        id?: string;
        recipientsCount?: number;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback(`Odesílám na ${j.recipientsCount} adres.`);
      setSubject('');
      setBodyText('');
      setTimeout(async () => {
        const refresh = await authFetch(`/api/admin/events/${eventId}/broadcast`);
        if (refresh.ok) {
          const jr = (await refresh.json()) as { broadcasts: Broadcast[] };
          setHistory(jr.broadcasts);
        }
      }, 2000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hromadná zpráva"
        description="Pošli e-mail všem (nebo vybrané skupině) buyerům akce. Pro ohlášení změn programu, přesunu, last-call připomínek."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {feedback ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {feedback}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Nová zpráva</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={send} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Komu (filtr)
              </label>
              <select
                value={filter}
                onChange={(e) =>
                  setFilter(e.target.value as 'paid_only' | 'all_buyers' | 'ticket_type' | 'waitlist')
                }
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="paid_only">Pouze zaplacení (paid + paid_partial)</option>
                <option value="all_buyers">Všichni buyeři (vč. pending)</option>
                <option value="ticket_type">Konkrétní ticket type</option>
                <option value="waitlist">Pouze waitlist</option>
              </select>
            </div>
            {filter === 'ticket_type' ? (
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  Ticket type
                </label>
                <select
                  value={ticketTypeId}
                  onChange={(e) => setTicketTypeId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  required
                >
                  <option value="">— vyber typ —</option>
                  {ticketTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Předmět
              </label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Změna programu — důležité informace"
                required
                maxLength={200}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Tělo zprávy
              </label>
              <textarea
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={8}
                required
                maxLength={10_000}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Ahoj, akce byla přesunuta z velké na malou scénu kvůli počasí. Děkujeme za pochopení."
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Plain text, jednoduchý HTML formátování per řádek. {bodyText.length} / 10 000 znaků.
              </p>
            </div>
            <Button type="submit" disabled={busy || !subject || !bodyText}>
              {busy ? 'Odesílám…' : 'Odeslat hromadnou zprávu'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historie ({history.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádné zprávy.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Předmět</th>
                  <th>Filtr</th>
                  <th className="text-right">Příjemci</th>
                  <th className="text-right">Odesláno</th>
                  <th>Status</th>
                  <th>Čas</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b.id} className="border-b">
                    <td className="py-2">{b.subject}</td>
                    <td className="text-xs">{b.filter}</td>
                    <td className="text-right tabular-nums">{b.recipients_count}</td>
                    <td className="text-right tabular-nums">
                      {b.sent_count}
                      {b.failed_count > 0 ? (
                        <span className="ml-1 text-rose-700">({b.failed_count} fail)</span>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={
                          b.status === 'completed'
                            ? 'rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800'
                            : b.status === 'sending'
                              ? 'rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800'
                              : 'rounded bg-rose-100 px-1.5 py-0.5 text-xs text-rose-800'
                        }
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {new Date(b.created_at).toLocaleString('cs-CZ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
