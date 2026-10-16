'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import { Wallet, Calendar } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface Schedule {
  id: string;
  installments: { daysBefore: number; pct: number }[];
  total_authorized_halire: number;
  total_paid_halire: number;
  status: string;
  installment_details: Array<{
    index: number; amount: number;
    scheduledFor: string; paidAt: string | null; status: string;
  }> | null;
}

function fmtKc(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

export default function AdvancePayoutPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [installments, setInstallments] = useState<{ daysBefore: number; pct: number }[]>([
    { daysBefore: 30, pct: 70 },
    { daysBefore: 0, pct: 30 },
  ]);

  useEffect(() => { void load(); }, [eventId]);

  async function load(): Promise<void> {
    try {
      const r = await typedGet<{ schedules: Schedule[] }>(`/api/admin/events/${eventId}/advance-payout`);
      setSchedules(r.schedules ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  function totalPct(): number {
    return installments.reduce((s, i) => s + i.pct, 0);
  }

  async function create(): Promise<void> {
    if (totalPct() > 100) {
      setError(`Součet pct (${totalPct()} %) přesahuje 100 %.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await typedPost(`/api/admin/events/${eventId}/advance-payout`, { installments }, { throwOnError: true });
      setShowForm(false);
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

  function updateInstallment(idx: number, key: 'daysBefore' | 'pct', value: number): void {
    setInstallments(installments.map((inst, i) => i === idx ? { ...inst, [key]: value } : inst));
  }

  function addInstallment(): void {
    setInstallments([...installments, { daysBefore: 0, pct: 0 }]);
  }

  function removeInstallment(idx: number): void {
    setInstallments(installments.filter((_, i) => i !== idx));
  }

  const active = schedules.find((s) => s.status === 'active');

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Pre-event payouts"
        description="Eventbrite-style schedule vyplácení části tržeb PŘED akcí pro cashflow."
      />

      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}

      {active ? (
        <Card className="border-emerald-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" /> Aktivní schedule
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Total cap</p>
                <p className="text-xl font-bold">{fmtKc(active.total_authorized_halire)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Vyplaceno</p>
                <p className="text-xl font-bold text-emerald-700">{fmtKc(active.total_paid_halire)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Zbývá vyplatit</p>
                <p className="text-xl font-bold">{fmtKc(active.total_authorized_halire - active.total_paid_halire)}</p>
              </div>
            </div>
            {active.installment_details ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-semibold">Splátky:</p>
                {active.installment_details.map((inst) => (
                  <div key={inst.index} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <div>
                      <p>{fmtKc(inst.amount)}</p>
                      <p className="text-xs text-muted-foreground">
                        <Calendar className="inline h-3 w-3" /> {new Date(inst.scheduledFor).toLocaleDateString('cs-CZ')}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-xs ${
                      inst.status === 'paid' ? 'bg-emerald-100 text-emerald-800' :
                      inst.status === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100'
                    }`}>{inst.status}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">
          {active ? 'Nová schedule nahradí aktivní' : 'Žádná aktivní schedule'}
        </p>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Zavřít' : (active ? 'Změnit' : '+ Vytvořit schedule')}</Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader><CardTitle>Nový schedule</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Eg. <strong>70 % T-30, 30 % T-0</strong> = 70 % se vyplatí 30 dní před akcí, zbytek v den akce.
            </p>
            {installments.map((inst, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs">Dní před akcí</label>
                  <Input type="number" min="0" max="365" value={inst.daysBefore}
                    onChange={(e) => updateInstallment(idx, 'daysBefore', Number(e.target.value))} />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs">% z tržeb</label>
                  <Input type="number" min="1" max="100" value={inst.pct}
                    onChange={(e) => updateInstallment(idx, 'pct', Number(e.target.value))} />
                </div>
                {installments.length > 1 ? (
                  <button type="button" onClick={() => removeInstallment(idx)}
                    className="mt-5 text-rose-600">×</button>
                ) : null}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addInstallment}>+ Splátka</Button>
            <p className="text-xs text-muted-foreground">
              Celkem: <strong>{totalPct()} %</strong> {totalPct() > 100 ? '⚠️ překračuje 100 %' : ''}
            </p>
            <Button onClick={create} disabled={busy || totalPct() === 0 || totalPct() > 100}>
              {busy ? 'Aktivuji…' : 'Aktivovat schedule'}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
