'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';
import { formatMoney } from '@/lib/format';

interface Affiliate {
  id: string;
  code: string;
  name: string;
  email: string | null;
  commission_pct: number;
  active: boolean;
  orders_count: number;
  revenue_total: string;
  commission_total: string;
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

export default function AffiliatesPage() {
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [commissionPct, setCommissionPct] = useState('10');
  const [bankAccount, setBankAccount] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const res = await authFetch('/api/admin/affiliates');
    if (res.ok) setAffiliates((((await res.json()) as { affiliates: Affiliate[] }).affiliates) ?? []);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch('/api/admin/affiliates', {
        method: 'POST',
        body: JSON.stringify({
          code: code.toUpperCase(),
          name,
          email: email || null,
          commissionPct: Number(commissionPct),
          bankAccount: bankAccount || null,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback(`Affiliate ${code} vytvořen.`);
      setCode('');
      setName('');
      setEmail('');
      setBankAccount('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Affiliate / referral program"
        description="Influenceři / partneři dostanou unique kód, % commission z každé objednávky která prošla přes ?ref=KOD."
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
          <CardTitle>Nový affiliate</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Kód (uppercase, používá v URL ?ref=…)
              </label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
                required
                placeholder="INFLUENCER10"
                pattern="[A-Z0-9_-]+"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Jméno</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Jane Doe (Instagram)"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">E-mail</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Commission %
              </label>
              <Input
                type="number"
                min={0}
                max={50}
                value={commissionPct}
                onChange={(e) => setCommissionPct(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Bankovní účet (pro payout)
              </label>
              <Input
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value)}
                placeholder="123456789/0100"
              />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={busy || !code || !name}>
                {busy ? 'Vytvářím…' : 'Vytvořit affiliate'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Affiliates ({affiliates.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {affiliates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádní affiliates.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Kód</th>
                  <th>Jméno</th>
                  <th className="text-right">%</th>
                  <th className="text-right">Orders</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">Commission</th>
                </tr>
              </thead>
              <tbody>
                {affiliates.map((a) => {
                  const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/cs/events?ref=${a.code}`;
                  return (
                    <tr key={a.id} className="border-b">
                      <td className="py-2">
                        <code className="rounded bg-muted px-1 py-0.5 text-xs">{a.code}</code>
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(url)}
                          className="ml-2 text-xs text-primary hover:underline"
                          title="Kopírovat URL"
                        >
                          📋
                        </button>
                      </td>
                      <td>
                        <div>{a.name}</div>
                        {a.email ? <div className="text-xs text-muted-foreground">{a.email}</div> : null}
                      </td>
                      <td className="text-right">{a.commission_pct}%</td>
                      <td className="text-right tabular-nums">{a.orders_count}</td>
                      <td className="text-right tabular-nums">
                        {formatMoney(Number(a.revenue_total), 'CZK')}
                      </td>
                      <td className="text-right tabular-nums font-medium">
                        {formatMoney(Number(a.commission_total), 'CZK')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
