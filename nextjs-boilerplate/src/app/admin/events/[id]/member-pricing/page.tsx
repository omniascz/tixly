'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/format';

interface TicketType {
  ticketTypeId: string;
  name: string;
  grossHalire: number;
}

interface Group {
  id: string;
  slug: string;
  name: string;
  member_count: number;
}

interface Rule {
  id: string;
  ticket_type_id: string;
  ticket_type_name: string;
  group_id: string;
  group_name: string;
  discount_pct: number | null;
  fixed_price_minor: number | null;
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

export default function MemberPricingPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [selectedTtId, setSelectedTtId] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [discountPct, setDiscountPct] = useState('20');
  const [fixedPriceMajor, setFixedPriceMajor] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const [tt, gr] = await Promise.all([
          authFetch(`/api/admin/events/${eventId}/sales-report`),
          authFetch('/api/admin/member-groups'),
        ]);
        if (tt.ok) {
          const j = (await tt.json()) as { byTicketType: TicketType[] };
          setTicketTypes(j.byTicketType ?? []);
        }
        if (gr.ok) setGroups((((await gr.json()) as { groups: Group[] }).groups) ?? []);
        await loadRules();
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [eventId]);

  async function loadRules() {
    // Load rules for each ticket type — TODO: better filter; pro teď načteme všechny rules promotéra a filterujeme client
    const ttResp = await authFetch(`/api/admin/events/${eventId}/sales-report`);
    if (!ttResp.ok) return;
    const ttData = (await ttResp.json()) as { byTicketType: { ticketTypeId: string }[] };
    const allRules: Rule[] = [];
    for (const tt of ttData.byTicketType) {
      const r = await authFetch(`/api/admin/member-pricing-rules?ticketTypeId=${tt.ticketTypeId}`);
      if (r.ok) {
        const j = (await r.json()) as { rules: Rule[] };
        allRules.push(...j.rules);
      }
    }
    setRules(allRules);
  }

  async function addRule() {
    if (!selectedTtId || !selectedGroupId) return;
    if (!discountPct && !fixedPriceMajor) {
      setError('Zadej discount % nebo fixní cenu.');
      return;
    }
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const body: Record<string, unknown> = {
        ticketTypeId: selectedTtId,
        groupId: selectedGroupId,
      };
      if (fixedPriceMajor) {
        body.fixedPriceMinor = Math.round(Number(fixedPriceMajor) * 100);
      } else {
        body.discountPct = Number(discountPct);
      }
      const res = await authFetch('/api/admin/member-pricing-rules', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback('Pravidlo přidáno.');
      setFixedPriceMajor('');
      await loadRules();
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(id: string) {
    if (!confirm('Opravdu smazat pravidlo?')) return;
    const res = await authFetch(`/api/admin/member-pricing-rules?id=${id}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setFeedback('Pravidlo smazáno.');
      await loadRules();
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Member pricing"
        description="Slevy pro registrované členské skupiny (Barcelona socios, Met Members)."
        actions={
          <Link href={`/admin/events/${eventId}/edit`}>
            <Button variant="outline" size="sm">
              ← Zpět
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

      {groups.length === 0 ? (
        <div className="rounded-md border bg-muted/30 p-4 text-sm">
          Nemáš žádnou členskou skupinu.{' '}
          <Link href="/admin/member-groups" className="text-primary hover:underline">
            Vytvoř první →
          </Link>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Přidat pravidlo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Ticket type</label>
              <select
                value={selectedTtId}
                onChange={(e) => setSelectedTtId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— vyber —</option>
                {ticketTypes.map((tt) => (
                  <option key={tt.ticketTypeId} value={tt.ticketTypeId}>
                    {tt.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Skupina</label>
              <select
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— vyber —</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.member_count})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Discount %</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={discountPct}
                onChange={(e) => setDiscountPct(e.target.value)}
                disabled={!!fixedPriceMajor}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Fixní cena (CZK; vyžaduje override discount)
              </label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={fixedPriceMajor}
                onChange={(e) => setFixedPriceMajor(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <Button onClick={addRule} disabled={busy || !selectedTtId || !selectedGroupId}>
                {busy ? 'Přidávám…' : 'Přidat pravidlo'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aktivní pravidla ({rules.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádná pravidla.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Ticket type</th>
                  <th>Skupina</th>
                  <th className="text-right">Sleva</th>
                  <th className="text-right">Akce</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="py-2">{r.ticket_type_name}</td>
                    <td>{r.group_name}</td>
                    <td className="text-right tabular-nums">
                      {r.fixed_price_minor !== null
                        ? formatMoney(r.fixed_price_minor, 'CZK')
                        : `−${r.discount_pct}%`}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => removeRule(r.id)}
                        className="text-xs text-rose-700 hover:underline"
                      >
                        Smazat
                      </button>
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
