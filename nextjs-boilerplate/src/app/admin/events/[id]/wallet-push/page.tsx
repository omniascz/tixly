'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import { Send, AlertTriangle, Megaphone, MapPin, Bell } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface Job {
  id: string;
  reason: string;
  status: string;
  scheduled_for: string;
  sent_at: string | null;
  ticket_id: string;
}

const REASONS = [
  { value: 'seat_changed', label: 'Změna sedadla', icon: MapPin },
  { value: 'gate_changed', label: 'Změna brány', icon: MapPin },
  { value: 'venue_changed', label: 'Změna lokace', icon: MapPin },
  { value: 'cancelled', label: 'Zrušeno', icon: AlertTriangle },
  { value: 'reminder', label: 'Připomínka', icon: Bell },
] as const;

type ReasonValue = (typeof REASONS)[number]['value'];

export default function WalletPushPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [jobs, setJobs] = useState<Job[]>([]);
  const [reason, setReason] = useState<ReasonValue>('reminder');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ enqueued: number } | null>(null);

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load(): Promise<void> {
    try {
      const r = await typedGet<{ jobs: Job[] }>(`/api/admin/events/${eventId}/wallet-push`);
      setJobs(r.jobs ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await typedPost<{ enqueued: number }>(
        `/api/admin/events/${eventId}/wallet-push`,
        { reason, payload: message ? { message } : undefined },
        { throwOnError: true },
      );
      setSuccess({ enqueued: r.enqueued });
      setMessage('');
      await load();
    } catch (err) {
      if (err instanceof TypedFetchError) {
        const body = err.body as { error?: string } | undefined;
        setError(body?.error ?? `HTTP ${err.status}`);
      } else {
        setError(err instanceof Error ? err.message : 'Chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  const sentCount = jobs.filter((j) => j.status === 'sent').length;
  const pendingCount = jobs.filter((j) => j.status === 'pending').length;
  const failedCount = jobs.filter((j) => j.status === 'failed').length;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Apple Wallet Push"
        description="Pošli update všem držitelům lístků s Apple Wallet (změna sedadla, brány, zrušení akce)"
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          Zařazeno do fronty: <strong>{success.enqueued}</strong> lístků. APNs cron zpracuje do 2 minut.
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Odesláno</p>
            <p className="mt-1 text-2xl font-bold text-emerald-700">{sentCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Ve frontě</p>
            <p className="mt-1 text-2xl font-bold text-amber-700">{pendingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Selhalo</p>
            <p className="mt-1 text-2xl font-bold text-rose-700">{failedCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-4 w-4" />
            Nový push
          </CardTitle>
          <CardDescription>
            Update se zobrazí na lock screenu všem majitelům lístků s Apple Wallet passem.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Důvod</label>
            <div className="grid grid-cols-5 gap-2">
              {REASONS.map((r) => {
                const Icon = r.icon;
                return (
                  <button
                    type="button"
                    key={r.value}
                    onClick={() => setReason(r.value)}
                    className={`flex flex-col items-center gap-1 rounded-md border p-3 text-xs transition ${
                      reason === r.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{r.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Zpráva (volitelně)</label>
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="např. „Tvé sedadlo bylo upgradenuto na VIP B7"
              maxLength={200}
            />
          </div>
          <Button onClick={send} disabled={busy}>
            <Send className="mr-1 h-4 w-4" />
            {busy ? 'Odesílám…' : 'Odeslat push'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historie push jobů ({jobs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Žádné push joby. Pošli první výše.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2">Důvod</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Plánováno</th>
                  <th className="pb-2">Odesláno</th>
                </tr>
              </thead>
              <tbody>
                {jobs.slice(0, 50).map((j) => (
                  <tr key={j.id} className="border-t">
                    <td className="py-2">{j.reason}</td>
                    <td className="py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        j.status === 'sent' ? 'bg-emerald-100 text-emerald-800' :
                        j.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                        j.status === 'failed' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100'
                      }`}>
                        {j.status}
                      </span>
                    </td>
                    <td className="py-2 text-xs">
                      {new Date(j.scheduled_for).toLocaleString('cs-CZ')}
                    </td>
                    <td className="py-2 text-xs">
                      {j.sent_at ? new Date(j.sent_at).toLocaleString('cs-CZ') : '—'}
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
