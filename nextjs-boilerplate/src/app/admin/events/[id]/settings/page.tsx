'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';

interface EventSettings {
  id: string;
  title: string;
  currency: string;
  queueEnabled: boolean;
  queueMaxConcurrent: number;
  insuranceEnabled: boolean;
  insurancePct: number;
}

interface PaymentPlan {
  id: string;
  name: string;
  deposit_pct: number;
  installments_count: number;
  interval_days: number;
  active: boolean;
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

export default function EventSettingsPage() {
  const params = useParams();
  const id = String(params.id);

  const [data, setData] = useState<EventSettings | null>(null);
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Plan form
  const [planName, setPlanName] = useState('');
  const [depositPct, setDepositPct] = useState('25');
  const [installmentsCount, setInstallmentsCount] = useState('3');
  const [intervalDays, setIntervalDays] = useState('30');

  useEffect(() => {
    void load();
    async function load() {
      try {
        const [evRes, plansRes] = await Promise.all([
          authFetch(`/api/admin/events/${id}`),
          authFetch(`/api/admin/events/${id}/payment-plans`),
        ]);
        if (!evRes.ok) {
          setError(`Nelze načíst akci (${evRes.status})`);
          return;
        }
        setData((await evRes.json()) as EventSettings);
        if (plansRes.ok) {
          setPlans((((await plansRes.json()) as { plans: PaymentPlan[] }).plans) ?? []);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [id]);

  async function saveSettings(patch: Partial<EventSettings>) {
    if (!data) return;
    setSaving(true);
    setFeedback(null);
    setError(null);
    try {
      const res = await authFetch(`/api/admin/events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setData({ ...data, ...patch });
      setFeedback('Uloženo.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function createPlan() {
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${id}/payment-plans`, {
        method: 'POST',
        body: JSON.stringify({
          name: planName,
          depositPct: Number(depositPct),
          installmentsCount: Number(installmentsCount),
          intervalDays: Number(intervalDays),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      // Reload plans
      const plansRes = await authFetch(`/api/admin/events/${id}/payment-plans`);
      setPlans((((await plansRes.json()) as { plans: PaymentPlan[] }).plans) ?? []);
      setPlanName('');
      setFeedback('Plán přidán.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!data && !error) {
    return <p className="text-sm text-muted-foreground">Načítání…</p>;
  }
  if (!data) {
    return <p className="text-sm text-rose-700">Chyba: {error}</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Nastavení akce — ${data.title}`}
        description="Pokročilé možnosti: virtuální fronta, pojistka zrušení, platební plány."
        actions={
          <Link href={`/admin/events/${id}/edit`}>
            <Button variant="outline" size="sm">
              ← Zpět na editaci
            </Button>
          </Link>
        }
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
          <CardTitle>Virtuální fronta</CardTitle>
          <CardDescription>
            Zapni pro on-sale momenty s vysokou poptávkou. Buyer projde čekárnou, server ho admituje
            postupně podle volných slotů.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={data.queueEnabled}
              onChange={(e) => saveSettings({ queueEnabled: e.target.checked })}
              disabled={saving}
            />
            Zapnout frontu pro tuto akci
          </label>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Max současných kupců na pokladně
            </label>
            <Input
              type="number"
              min={1}
              max={100000}
              value={data.queueMaxConcurrent}
              onChange={(e) =>
                setData({ ...data, queueMaxConcurrent: Number(e.target.value) })
              }
              onBlur={() => saveSettings({ queueMaxConcurrent: data.queueMaxConcurrent })}
              disabled={saving || !data.queueEnabled}
              className="max-w-32"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Demo: ~100. Real festival on-sale: 500–2000 dle DB scaling.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pojistka zrušení (refund insurance)</CardTitle>
          <CardDescription>
            Buyer si na checkoutu zaškrtne add-on. Po pojistné události může uplatnit refund přes
            mock_insurer (produkce: XCover / Booking Protect).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={data.insuranceEnabled}
              onChange={(e) => saveSettings({ insuranceEnabled: e.target.checked })}
              disabled={saving}
            />
            Nabízet pojistku zrušení
          </label>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Pojistné v % z ceny objednávky
            </label>
            <Input
              type="number"
              min={0}
              max={50}
              value={data.insurancePct}
              onChange={(e) => setData({ ...data, insurancePct: Number(e.target.value) })}
              onBlur={() => saveSettings({ insurancePct: data.insurancePct })}
              disabled={saving || !data.insuranceEnabled}
              className="max-w-24"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Standard: 6–10 %. Limit: 0–50 %.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Platební plány</CardTitle>
          <CardDescription>
            Buyer si na checkoutu vybere plán: 100 % zaplaceno hned, nebo X % záloha + N splátek
            každých D dní.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádný plán.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Název</th>
                  <th>Záloha</th>
                  <th>Splátky</th>
                  <th>Interval</th>
                  <th>Aktivní</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="py-2">{p.name}</td>
                    <td>{p.deposit_pct} %</td>
                    <td>{p.installments_count}×</td>
                    <td>{p.interval_days} dní</td>
                    <td>{p.active ? 'Ano' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="rounded-md border bg-muted/30 p-3">
            <h4 className="mb-2 text-sm font-semibold">Přidat plán</h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Input
                placeholder="Název (např. 25 % + 3×)"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
              />
              <Input
                type="number"
                min={0}
                max={100}
                value={depositPct}
                onChange={(e) => setDepositPct(e.target.value)}
                placeholder="Záloha %"
              />
              <Input
                type="number"
                min={0}
                max={24}
                value={installmentsCount}
                onChange={(e) => setInstallmentsCount(e.target.value)}
                placeholder="Splátky"
              />
              <Input
                type="number"
                min={1}
                max={365}
                value={intervalDays}
                onChange={(e) => setIntervalDays(e.target.value)}
                placeholder="Dní"
              />
            </div>
            <Button
              size="sm"
              className="mt-2"
              onClick={createPlan}
              disabled={!planName.trim()}
            >
              Přidat plán
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
