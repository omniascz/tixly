'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';


interface ResponseSummary {
  accepted?: number;
  exchange_requested?: number;
  refund_requested?: number;
}

interface Announcement {
  id: string;
  subject: string;
  message: string;
  cast_change: string | null;
  offer_exchange: boolean;
  offer_refund: boolean;
  recipient_count: number;
  sent_at: string | null;
  created_at: string;
  responses: ResponseSummary;
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

export default function EmergencyPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [history, setHistory] = useState<Announcement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [subject, setSubject] = useState('Důležitá změna v programu');
  const [message, setMessage] = useState('');
  const [castChange, setCastChange] = useState('');
  const [offerExchange, setOfferExchange] = useState(true);
  const [offerRefund, setOfferRefund] = useState(true);

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load() {
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/emergency`);
      if (res.ok) {
        const j = (await res.json()) as { announcements: Announcement[] };
        setHistory(j.announcements);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (
      !confirm(
        `Opravdu odeslat nouzové oznámení VŠEM držitelům vstupenek? Tuto akci nelze vzít zpět.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/emergency`, {
        method: 'POST',
        body: JSON.stringify({
          subject,
          message,
          castChange: castChange.trim() || undefined,
          offerExchange,
          offerRefund,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        announcementId?: string;
        recipientCount?: number;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback(`Oznámení odesláno ${j.recipientCount} příjemcům.`);
      setMessage('');
      setCastChange('');
      setSubject('Důležitá změna v programu');
      setOfferExchange(true);
      setOfferRefund(true);
      void load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nouzové oznámení"
        description="Pošle email všem držitelům vstupenek na tento večer."
      />

      <div className="rounded-md border-2 border-red-500 bg-red-50 p-4 text-sm text-red-900">
        <strong className="block text-base font-bold">
          Toto odešle email VŠEM držitelům vstupenek na tento večer. Nelze vzít zpět.
        </strong>
        <p className="mt-1">
          Použij pouze pro skutečné nouzové situace — změna obsazení, zrušení představení, evakuace
          atp.
        </p>
      </div>

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
          <CardTitle>Odeslat nouzové oznámení</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={send} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Předmět
              </label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Důležitá změna v programu"
                required
                maxLength={300}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Zpráva
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={8}
                required
                maxLength={10000}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Vážení diváci, oznamujeme..."
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {message.length} / 10 000 znaků
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Změna obsazení (volitelné)
              </label>
              <Input
                value={castChange}
                onChange={(e) => setCastChange(e.target.value)}
                placeholder="Jan Novák → Petr Kučera jako Romeo"
                maxLength={500}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={offerExchange}
                  onChange={(e) => setOfferExchange(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                Nabídnout výměnu termínu
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={offerRefund}
                  onChange={(e) => setOfferRefund(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                Nabídnout vrácení peněz
              </label>
            </div>

            <Button
              type="submit"
              disabled={busy || !subject || !message}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {busy ? 'Odesílám…' : 'Odeslat nouzové oznámení'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historie oznámení ({history.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádná oznámení.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Datum</th>
                  <th>Předmět</th>
                  <th className="text-right">Příjemci</th>
                  <th>Akce</th>
                </tr>
              </thead>
              <tbody>
                {history.map((ann) => (
                  <>
                    <tr key={ann.id} className="border-b">
                      <td className="py-2 text-xs text-muted-foreground">
                        {new Date(ann.created_at).toLocaleString('cs-CZ')}
                      </td>
                      <td className="py-2 font-medium">{ann.subject}</td>
                      <td className="py-2 text-right tabular-nums">{ann.recipient_count}</td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId(expandedId === ann.id ? null : ann.id)
                          }
                          className="text-xs underline text-primary"
                        >
                          {expandedId === ann.id ? 'Skrýt' : 'Odpovědi'}
                        </button>
                      </td>
                    </tr>
                    {expandedId === ann.id ? (
                      <tr key={`${ann.id}-detail`} className="border-b bg-muted/30">
                        <td colSpan={4} className="px-4 py-3">
                          <div className="space-y-2 text-sm">
                            {ann.cast_change ? (
                              <p>
                                <span className="font-medium">Změna obsazení:</span>{' '}
                                {ann.cast_change}
                              </p>
                            ) : null}
                            <p className="text-muted-foreground whitespace-pre-wrap">
                              {ann.message}
                            </p>
                            <div className="flex gap-3 pt-1">
                              <span className="rounded border px-2 py-0.5 text-xs">
                                Přijato: {ann.responses.accepted ?? 0}
                              </span>
                              {ann.offer_exchange ? (
                                <span className="rounded border border-amber-400 px-2 py-0.5 text-xs text-amber-700">
                                  Výměna: {ann.responses.exchange_requested ?? 0}
                                </span>
                              ) : null}
                              {ann.offer_refund ? (
                                <span className="rounded border border-rose-400 px-2 py-0.5 text-xs text-rose-700">
                                  Refund: {ann.responses.refund_requested ?? 0}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
