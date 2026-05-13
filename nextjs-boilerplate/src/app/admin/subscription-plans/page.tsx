'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';
import { Trash2, Users, Calendar } from 'lucide-react';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  priceHalire: number;
  billingCycle: 'monthly' | 'yearly';
  allowancePerPeriod: number;
  active: boolean;
  activeSubscriptions: number;
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

export default function SubscriptionPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceCzk, setPriceCzk] = useState('');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');
  const [allowance, setAllowance] = useState('8');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const res = await authFetch('/api/admin/subscription-plans');
    if (!res.ok) return;
    const data = (await res.json()) as { plans: Plan[] };
    setPlans(data.plans ?? []);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await authFetch('/api/admin/subscription-plans', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: description || undefined,
          priceHalire: Math.round(Number(priceCzk) * 100),
          billingCycle,
          allowancePerPeriod: Number(allowance),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? 'Vytvoření selhalo.');
        return;
      }
      setName('');
      setDescription('');
      setPriceCzk('');
      setAllowance('8');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(plan: Plan) {
    setBusy(true);
    try {
      await authFetch(`/api/admin/subscription-plans/${plan.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !plan.active }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function deletePlan(plan: Plan) {
    if (plan.activeSubscriptions > 0) {
      if (
        !confirm(
          `${plan.activeSubscriptions} aktivních předplatitelů. Plán bude jen deaktivován (no new sales); existující předplatné platí dál.`,
        )
      )
        return;
    } else {
      if (!confirm(`Opravdu smazat plán „${plan.name}"?`)) return;
    }
    setBusy(true);
    try {
      const res = await authFetch(`/api/admin/subscription-plans/${plan.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? 'Smazání selhalo.');
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Permanentky / Předplatné"
        description='Definuj sezónní permanentky („8 představení / rok") nebo měsíční členství. Buyer si je koupí v /cs/subscriptions.'
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Nová permanentka</CardTitle>
            <CardDescription>
              Allowance = počet lístků za období. Cena se zaplatí dopředu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label htmlFor="sp-name" className="mb-1 block text-xs font-medium">
                  Název
                </label>
                <Input
                  id="sp-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Sezónní permanentka 2026/27"
                  required
                />
              </div>
              <div>
                <label htmlFor="sp-desc" className="mb-1 block text-xs font-medium">
                  Popis (volitelné)
                </label>
                <textarea
                  id="sp-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  placeholder="8 představení podle vašeho výběru ze sezóny 2026/27."
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="sp-price" className="mb-1 block text-xs font-medium">
                    Cena (Kč)
                  </label>
                  <Input
                    id="sp-price"
                    type="number"
                    min={0}
                    value={priceCzk}
                    onChange={(e) => setPriceCzk(e.target.value)}
                    placeholder="2800"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="sp-cycle" className="mb-1 block text-xs font-medium">
                    Cyklus
                  </label>
                  <select
                    id="sp-cycle"
                    value={billingCycle}
                    onChange={(e) => setBillingCycle(e.target.value as typeof billingCycle)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="yearly">Roční</option>
                    <option value="monthly">Měsíční</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="sp-allow" className="mb-1 block text-xs font-medium">
                    Lístků za období
                  </label>
                  <Input
                    id="sp-allow"
                    type="number"
                    min={1}
                    max={1000}
                    value={allowance}
                    onChange={(e) => setAllowance(e.target.value)}
                    required
                  />
                </div>
              </div>
              {error ? (
                <div className="rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
                  {error}
                </div>
              ) : null}
              <Button type="submit" disabled={busy || !name || !priceCzk}>
                {busy ? 'Vytvářím…' : 'Vytvořit plán'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Existující plány ({plans.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {plans.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Žádné plány. Vytvoř první vlevo.
              </p>
            ) : (
              <ul className="space-y-2">
                {plans.map((p) => (
                  <li
                    key={p.id}
                    className={`rounded-md border p-3 text-sm ${p.active ? '' : 'opacity-60'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{p.name}</span>
                          {!p.active ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                              neaktivní
                            </span>
                          ) : null}
                        </div>
                        {p.description ? (
                          <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                        ) : null}
                        <p className="mt-1 text-xs">
                          <strong>{(p.priceHalire / 100).toLocaleString('cs-CZ')} Kč</strong>{' '}
                          / {p.billingCycle === 'yearly' ? 'rok' : 'měsíc'} ·{' '}
                          <Calendar className="inline h-3 w-3" aria-hidden /> {p.allowancePerPeriod}{' '}
                          lístků
                          {' · '}
                          <Users className="inline h-3 w-3" aria-hidden /> {p.activeSubscriptions}{' '}
                          předplatitelů
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <button
                          type="button"
                          onClick={() => void toggleActive(p)}
                          className="text-xs text-primary hover:underline"
                          disabled={busy}
                        >
                          {p.active ? 'Deaktivovat' : 'Aktivovat'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deletePlan(p)}
                          className="rounded p-1 text-rose-700 hover:bg-rose-50"
                          aria-label={`Smazat plán ${p.name}`}
                          disabled={busy}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
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
