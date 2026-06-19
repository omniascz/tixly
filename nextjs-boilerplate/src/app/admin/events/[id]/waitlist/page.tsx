'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, RefreshCw } from 'lucide-react';

interface WaitlistEntry {
  id: string;
  email: string;
  name: string | null;
  position: number;
  status: 'waiting' | 'offered' | 'converted' | 'cancelled' | 'expired';
  created_at: string;
  offered_at: string | null;
  offer_expires_at: string | null;
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

function StatusBadge({ entry }: { entry: WaitlistEntry }) {
  const now = Date.now();
  const expiresAt = entry.offer_expires_at ? new Date(entry.offer_expires_at).getTime() : null;
  const secondsLeft =
    entry.status === 'offered' && expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : null;

  const base = 'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold';

  if (entry.status === 'waiting') {
    return <span className={`${base} border-gray-200 bg-gray-100 text-gray-700`}>Čeká</span>;
  }
  if (entry.status === 'offered') {
    const mins = secondsLeft !== null ? Math.ceil(secondsLeft / 60) : null;
    return (
      <span className={`${base} border-yellow-300 bg-yellow-100 text-yellow-800`}>
        Nabídnuto{mins !== null ? ` (${mins} min)` : ''}
      </span>
    );
  }
  if (entry.status === 'converted') {
    return <span className={`${base} border-emerald-300 bg-emerald-100 text-emerald-800`}>Převedeno</span>;
  }
  if (entry.status === 'expired') {
    return <span className={`${base} border-rose-300 bg-rose-100 text-rose-800`}>Expirováno</span>;
  }
  return <span className={`${base} border-gray-200 bg-white text-gray-500`}>Zrušeno</span>;
}

export default function WaitlistAdminPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void load();
    intervalRef.current = setInterval(() => void load(), 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [eventId]);

  async function load() {
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/waitlist`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as { entries: WaitlistEntry[] };
      setEntries(j.entries ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    } finally {
      setLoading(false);
    }
  }

  async function postAction(action: 'offer_next' | 'advance_expired') {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/waitlist`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        entry?: WaitlistEntry | null;
        expiresAt?: string | null;
        expiredCount?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      if (action === 'offer_next') {
        if (j.entry) {
          setFeedback(`Nabídnuto: ${j.entry.email} (vyprší ${j.expiresAt ? new Date(j.expiresAt).toLocaleTimeString('cs-CZ') : '?'})`);
        } else {
          setFeedback('Žádný čekající zájemce.');
        }
      } else {
        setFeedback(
          `Expirováno: ${j.expiredCount ?? 0}. ${j.entry ? `Nově nabídnuto: ${j.entry.email}` : 'Nikdo další nečeká.'}`,
        );
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function patchEntry(entryId: string, status: 'converted' | 'cancelled') {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/waitlist/${entryId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        checkoutUrl?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      if (status === 'converted' && j.checkoutUrl) {
        setFeedback(`Objednávka vytvořena. Platební link: ${j.checkoutUrl}`);
      } else {
        setFeedback('Zrušeno.');
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  const waiting = entries.filter((e) => e.status === 'waiting').length;
  const offered = entries.filter((e) => e.status === 'offered').length;
  const converted = entries.filter((e) => e.status === 'converted').length;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Čekací listina"
        description="Správa čekací listiny pro vyprodané představení."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void postAction('offer_next')}
          disabled={busy || waiting === 0}
          size="sm"
        >
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
          Nabídnout dalšímu
        </Button>
        <Button
          variant="outline"
          onClick={() => void postAction('advance_expired')}
          disabled={busy}
          size="sm"
        >
          Expirovat + posunout
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          disabled={busy}
          aria-label="Obnovit"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
        </Button>
        <span className="text-xs text-muted-foreground">
          Čeká: {waiting} | Nabídnuto: {offered} | Převedeno: {converted}
        </span>
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
          <CardTitle>Záznamy</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Načítám…
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Čekací listina je prázdná.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 text-left font-medium">Pořadí</th>
                    <th className="pb-2 pr-4 text-left font-medium">Jméno</th>
                    <th className="pb-2 pr-4 text-left font-medium">E-mail</th>
                    <th className="pb-2 pr-4 text-left font-medium">Status</th>
                    <th className="pb-2 pr-4 text-left font-medium">Zapsán</th>
                    <th className="pb-2 text-left font-medium">Vyprší</th>
                    <th className="pb-2 text-left font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono">{entry.position}</td>
                      <td className="py-2 pr-4">{entry.name ?? '—'}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{entry.email}</td>
                      <td className="py-2 pr-4">
                        <StatusBadge entry={entry} />
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {new Date(entry.created_at).toLocaleDateString('cs-CZ')}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {entry.offer_expires_at
                          ? new Date(entry.offer_expires_at).toLocaleTimeString('cs-CZ', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </td>
                      <td className="py-2">
                        <div className="flex gap-1">
                          {entry.status === 'offered' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              disabled={busy}
                              onClick={() => void patchEntry(entry.id, 'converted')}
                            >
                              Převést
                            </Button>
                          ) : null}
                          {entry.status === 'waiting' || entry.status === 'offered' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs text-muted-foreground"
                              disabled={busy}
                              onClick={() => void patchEntry(entry.id, 'cancelled')}
                            >
                              Zrušit
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
