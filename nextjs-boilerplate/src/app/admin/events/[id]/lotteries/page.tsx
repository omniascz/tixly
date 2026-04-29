'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';

interface Lottery {
  id: string;
  name: string;
  description: string | null;
  opens_at: string;
  closes_at: string;
  draw_at: string;
  status: string;
  allocation_total: number;
  entries_count: number;
  winners_count: number;
}

interface TicketType {
  ticketTypeId: string;
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

export default function LotteriesPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [lotteries, setLotteries] = useState<Lottery[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Form
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [drawAt, setDrawAt] = useState('');
  const [allocationTotal, setAllocationTotal] = useState('1000');
  const [maxPerEntry, setMaxPerEntry] = useState('4');
  const [paymentDeadlineHours, setPaymentDeadlineHours] = useState('72');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const [lr, tt] = await Promise.all([
          authFetch(`/api/admin/events/${eventId}/lotteries`),
          authFetch(`/api/admin/events/${eventId}/sales-report`),
        ]);
        if (lr.ok) setLotteries((((await lr.json()) as { lotteries: Lottery[] }).lotteries) ?? []);
        if (tt.ok) {
          const j = (await tt.json()) as { byTicketType: TicketType[] };
          setTicketTypes(j.byTicketType ?? []);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [eventId]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/lotteries`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: description || null,
          opensAt: new Date(opensAt).toISOString(),
          closesAt: new Date(closesAt).toISOString(),
          drawAt: new Date(drawAt).toISOString(),
          allocationTotal: Number(allocationTotal),
          maxPerEntry: Number(maxPerEntry),
          paymentDeadlineHours: Number(paymentDeadlineHours),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback('Losování vytvořeno.');
      setName('');
      setDescription('');
      const refresh = await authFetch(`/api/admin/events/${eventId}/lotteries`);
      if (refresh.ok) setLotteries((((await refresh.json()) as { lotteries: Lottery[] }).lotteries) ?? []);
    } finally {
      setBusy(false);
    }
  }

  async function draw(lotteryId: string, name: string) {
    if (!confirm(`Spustit losování "${name}"? Tato akce je nevratná — winners + losers se zfixují.`)) return;
    setError(null);
    setFeedback(null);
    const res = await authFetch(
      `/api/admin/events/${eventId}/lotteries/${lotteryId}/draw`,
      { method: 'POST' },
    );
    const j = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      winnersCount?: number;
      losersCount?: number;
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      setError(j.message ?? j.error ?? `HTTP ${res.status}`);
      return;
    }
    setFeedback(`Vylosováno: ${j.winnersCount} winners, ${j.losersCount} losers.`);
    const refresh = await authFetch(`/api/admin/events/${eventId}/lotteries`);
    if (refresh.ok) setLotteries((((await refresh.json()) as { lotteries: Lottery[] }).lotteries) ?? []);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Losování (lottery)"
        description="Pro on-sale moments s extrémním převisem poptávky (UEFA, Coachella). Buyeři se přihlásí, admin vylosuje, winners dostanou time-limited payment link."
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
          <CardTitle>Nové losování</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Název
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="např. CL Final 2026 — Cat 1 ballot"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Popis (volitelné)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Opens at
              </label>
              <Input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Closes at
              </label>
              <Input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Draw at
              </label>
              <Input type="datetime-local" value={drawAt} onChange={(e) => setDrawAt(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Payment deadline (hodin po draw)
              </label>
              <Input type="number" min={1} max={720} value={paymentDeadlineHours} onChange={(e) => setPaymentDeadlineHours(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Total allocation (kolik lístků celkem)
              </label>
              <Input type="number" min={1} value={allocationTotal} onChange={(e) => setAllocationTotal(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Max per entry (kolik max 1 buyer)
              </label>
              <Input type="number" min={1} max={20} value={maxPerEntry} onChange={(e) => setMaxPerEntry(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? 'Vytvářím…' : 'Vytvořit losování'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Losování ({lotteries.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {lotteries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádné.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Název</th>
                  <th>Status</th>
                  <th className="text-right">Allocation</th>
                  <th className="text-right">Entries</th>
                  <th className="text-right">Winners</th>
                  <th>Closes</th>
                  <th className="text-right">Akce</th>
                </tr>
              </thead>
              <tbody>
                {lotteries.map((l) => (
                  <tr key={l.id} className="border-b">
                    <td className="py-2 font-medium">{l.name}</td>
                    <td>
                      <StatusBadge status={l.status} />
                    </td>
                    <td className="text-right tabular-nums">{l.allocation_total}</td>
                    <td className="text-right tabular-nums">{l.entries_count}</td>
                    <td className="text-right tabular-nums">{l.winners_count}</td>
                    <td className="text-xs text-muted-foreground">
                      {new Date(l.closes_at).toLocaleString('cs-CZ')}
                    </td>
                    <td className="text-right">
                      {(l.status === 'open' || l.status === 'closed') ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => draw(l.id, l.name)}
                        >
                          Losovat
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {ticketTypes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Pozn.: Akce nemá žádné ticket types — buyer při entry vybere typ vstupenky, ujisti
          se, že existují.
        </p>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    open: 'bg-emerald-100 text-emerald-800',
    closed: 'bg-amber-100 text-amber-800',
    drawn: 'bg-blue-100 text-blue-800',
    completed: 'bg-slate-100 text-slate-700',
    cancelled: 'bg-rose-100 text-rose-800',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? 'bg-muted'}`}>
      {status}
    </span>
  );
}
