'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import { Users, AlertTriangle, CheckCircle2, RefreshCw, Clock } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { typedGet, typedFetch, TypedFetchError } from '@/lib/typed-fetch';

interface EventItem {
  id: string;
  name: string;
  date: string;
}

interface RescheduleResult {
  rescheduleId: string;
  recipientCount: number;
  responseDeadline: string;
}

interface Stats {
  total: number;
  accepted: number;
  refunds: number;
  pending: number;
}

interface ResponseDetail {
  id: string;
  order_id: string;
  email: string;
  name: string | null;
  response: string | null;
  responded_at: string | null;
}

interface StatsPayload {
  rescheduleId: string;
  stats: Stats;
  responses: ResponseDetail[];
}

function responseBadge(r: string | null): JSX.Element {
  if (r === 'accepted') return <Badge className="bg-emerald-600 text-white">Přijal</Badge>;
  if (r === 'refund_requested') return <Badge className="bg-blue-600 text-white">Chce refund</Badge>;
  return <Badge variant="secondary">Čeká</Badge>;
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }): JSX.Element {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function ReschedulePage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [events, setEvents] = useState<EventItem[]>([]);
  const [reason, setReason] = useState('');
  const [newEventId, setNewEventId] = useState('');
  const [deadlineHours, setDeadlineHours] = useState(72);
  const [offerRefund, setOfferRefund] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RescheduleResult | null>(null);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [buyerCount, setBuyerCount] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void loadEvents();
    void checkExisting();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [eventId]);

  async function loadEvents(): Promise<void> {
    try {
      const data = await typedGet<EventItem[]>('/api/admin/events');
      setEvents(data.filter((e) => e.id !== eventId));
    } catch {
      // non-critical
    }
  }

  async function checkExisting(): Promise<void> {
    try {
      const data = await typedGet<{ reschedules: Array<{ recipient_count: number }> }>(
        `/api/admin/events/${eventId}/reschedule`,
      );
      if (data.reschedules.length > 0) {
        setBuyerCount(data.reschedules[0].recipient_count);
        await loadStats();
        setResult({
          rescheduleId: '',
          recipientCount: data.reschedules[0].recipient_count,
          responseDeadline: '',
        });
        startPolling();
      }
    } catch {
      // first time
    }
  }

  async function loadStats(): Promise<void> {
    try {
      const data = await typedGet<StatsPayload>(
        `/api/admin/events/${eventId}/reschedule/stats`,
      );
      setStats(data);
    } catch {
      // noop
    }
  }

  function startPolling(): void {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      void loadStats();
    }, 30_000);
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const data = await typedFetch<RescheduleResult>(`/api/admin/events/${eventId}/reschedule`, {
        method: 'POST',
        body: {
          reason,
          newEventId: newEventId || undefined,
          offerRefund,
          responseDeadlineHours: deadlineHours,
        },
        throwOnError: true,
      });
      setResult(data);
      setBuyerCount(data.recipientCount);
      await loadStats();
      startPolling();
    } catch (err) {
      if (err instanceof TypedFetchError) {
        const body = err.body as { error?: string };
        setError(body.error ?? `HTTP ${err.status}`);
      } else {
        setError(err instanceof Error ? err.message : 'Chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Přesun termínu"
        description="Přesuňte všechny ticket holdery na nový termín jedním krokem."
      />

      {error && (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      {!result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Odeslat oznámení o přesunu
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium">
                Důvod přesunu <span className="text-rose-500">*</span>
              </label>
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                rows={3}
                maxLength={2000}
                placeholder="např. nemoc umělce, technické problémy se sálem, vyšší moc"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">
                Nový termín (volitelně — vyberte jiný event téhož promotéra)
              </label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={newEventId}
                onChange={(e) => setNewEventId(e.target.value)}
              >
                <option value="">— Zatím neurčen —</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({new Date(e.date).toLocaleDateString('cs-CZ')})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Pokud nevyberete, zákazníci budou jen upozorněni — mohou čekat nebo požádat o refund.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Deadline pro odpověď (hodin)
                </label>
                <input
                  type="number"
                  min={1}
                  max={720}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={deadlineHours}
                  onChange={(e) => setDeadlineHours(Number(e.target.value))}
                />
              </div>

              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={offerRefund}
                    onChange={(e) => setOfferRefund(e.target.checked)}
                    className="h-4 w-4 rounded border accent-primary"
                  />
                  <span className="text-sm">Nabídnout vrácení peněz</span>
                </label>
              </div>
            </div>

            <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
              <div className="flex gap-2">
                <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-700 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">Pozor — nezvratná akce</p>
                  <p className="mt-1 text-xs text-amber-800">
                    Toto odešle oznámení <strong>VŠEM ticket holderům</strong> původního termínu.
                    {buyerCount != null && ` (${buyerCount} osob)`}
                    {' '}Nelze vzít zpět.
                  </p>
                </div>
              </div>
            </div>

            <Button
              onClick={() => void submit()}
              disabled={busy || !reason.trim()}
              className="w-full"
            >
              {busy ? 'Odesílám oznámení…' : 'Odeslat oznámení o přesunu termínu'}
            </Button>
          </CardContent>
        </Card>
      )}

      {result && stats && (
        <div className="space-y-4">
          <Card className="border-emerald-200 bg-emerald-50/30">
            <CardContent className="pt-5">
              <div className="flex items-center gap-2 text-emerald-800 mb-1">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-semibold">Oznámení odesláno</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Celkem notifikováno: <strong>{stats.stats.total}</strong> ticket holderů.
                {result.responseDeadline && (
                  <> Deadline: <strong>{new Date(result.responseDeadline).toLocaleString('cs-CZ')}</strong></>
                )}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Live statistiky odpovědí</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void loadStats()}
                  className="gap-1 text-xs"
                >
                  <RefreshCw className="h-3 w-3" />
                  Obnovit
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg border bg-emerald-50 p-3">
                  <p className="text-2xl font-bold text-emerald-700">{stats.stats.accepted}</p>
                  <p className="text-xs text-muted-foreground mt-1">Přijali</p>
                </div>
                <div className="rounded-lg border bg-blue-50 p-3">
                  <p className="text-2xl font-bold text-blue-700">{stats.stats.refunds}</p>
                  <p className="text-xs text-muted-foreground mt-1">Chtějí refund</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-2xl font-bold text-muted-foreground">{stats.stats.pending}</p>
                  <p className="text-xs text-muted-foreground mt-1">Čeká na odpověď</p>
                </div>
              </div>

              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-emerald-700 font-medium">Přijali</span>
                    <span className="text-muted-foreground">
                      {stats.stats.accepted}/{stats.stats.total}
                    </span>
                  </div>
                  <ProgressBar value={stats.stats.accepted} max={stats.stats.total} color="bg-emerald-500" />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-blue-700 font-medium">Chtějí refund</span>
                    <span className="text-muted-foreground">
                      {stats.stats.refunds}/{stats.stats.total}
                    </span>
                  </div>
                  <ProgressBar value={stats.stats.refunds} max={stats.stats.total} color="bg-blue-500" />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground font-medium">Čeká na odpověď</span>
                    <span className="text-muted-foreground">
                      {stats.stats.pending}/{stats.stats.total}
                    </span>
                  </div>
                  <ProgressBar value={stats.stats.pending} max={stats.stats.total} color="bg-gray-400" />
                </div>
              </div>

              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Automaticky aktualizuje každých 30 s
              </div>
            </CardContent>
          </Card>

          {stats.responses.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Jednotlivé odpovědi</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">E-mail</th>
                        <th className="pb-2 pr-4 font-medium">Jméno</th>
                        <th className="pb-2 pr-4 font-medium">Odpověď</th>
                        <th className="pb-2 font-medium">Čas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.responses.map((r) => (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-mono text-xs">{r.email}</td>
                          <td className="py-2 pr-4 text-muted-foreground">{r.name ?? '—'}</td>
                          <td className="py-2 pr-4">{responseBadge(r.response)}</td>
                          <td className="py-2 text-xs text-muted-foreground">
                            {r.responded_at
                              ? new Date(r.responded_at).toLocaleString('cs-CZ')
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
