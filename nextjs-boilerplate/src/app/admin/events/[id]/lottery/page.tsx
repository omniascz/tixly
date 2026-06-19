'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface LotteryEntry {
  id: string;
  email: string;
  name: string | null;
  status: string;
  payment_deadline: string | null;
  order_id: string | null;
  created_at: string;
}

interface Campaign {
  id: string;
  ticket_type_id: string | null;
  ticket_type_name: string | null;
  status: string;
  max_winners: number;
  registration_opens: string | null;
  registration_closes: string;
  draw_at: string;
  payment_window_hours: number;
  entry_count: number;
  winner_count: number | null;
  drawn_at: string | null;
  entries: LotteryEntry[];
}

interface TicketType {
  id: string;
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

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700',
    open: 'bg-emerald-100 text-emerald-800',
    closed: 'bg-amber-100 text-amber-800',
    drawn: 'bg-blue-100 text-blue-800',
    completed: 'bg-slate-100 text-slate-700',
  };
  const labels: Record<string, string> = {
    draft: 'Návrh',
    open: 'Otevřeno',
    closed: 'Uzavřeno',
    drawn: 'Vylosováno',
    completed: 'Dokončeno',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${variants[status] ?? 'bg-muted'}`}>
      {labels[status] ?? status}
    </span>
  );
}

function EntryStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    won: 'bg-yellow-100 text-yellow-800',
    converted: 'bg-emerald-100 text-emerald-800',
    expired: 'bg-rose-100 text-rose-800',
    lost: 'bg-slate-100 text-slate-500',
    entered: 'bg-sky-100 text-sky-800',
  };
  const labels: Record<string, string> = {
    won: 'Výherce',
    converted: 'Zaplaceno',
    expired: 'Propadlo',
    lost: 'Prohrál',
    entered: 'Zapsán',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? 'bg-muted'}`}>
      {labels[status] ?? status}
    </span>
  );
}

export default function LotteryAdminPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [ticketTypeId, setTicketTypeId] = useState('');
  const [maxWinners, setMaxWinners] = useState('100');
  const [registrationOpens, setRegistrationOpens] = useState('');
  const [registrationCloses, setRegistrationCloses] = useState('');
  const [drawAt, setDrawAt] = useState('');
  const [paymentWindowHours, setPaymentWindowHours] = useState('48');

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load() {
    setError(null);
    try {
      const [cr, tr] = await Promise.all([
        authFetch(`/api/admin/events/${eventId}/lottery`),
        authFetch(`/api/admin/events/${eventId}/ticket-types`),
      ]);
      if (cr.ok) {
        const j = (await cr.json()) as { campaigns: Campaign[] };
        setCampaigns(j.campaigns ?? []);
      }
      if (tr.ok) {
        const j = (await tr.json()) as { ticketTypes?: TicketType[] };
        setTicketTypes(j.ticketTypes ?? []);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function createCampaign(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/lottery`, {
        method: 'POST',
        body: JSON.stringify({
          ticketTypeId: ticketTypeId || undefined,
          maxWinners: Number(maxWinners),
          registrationOpens: registrationOpens ? new Date(registrationOpens).toISOString() : undefined,
          registrationCloses: new Date(registrationCloses).toISOString(),
          drawAt: new Date(drawAt).toISOString(),
          paymentWindowHours: Number(paymentWindowHours),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback('Losování vytvořeno.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function patchStatus(campaignId: string, status: 'open' | 'closed') {
    setError(null);
    setFeedback(null);
    const res = await authFetch(`/api/admin/events/${eventId}/lottery`, {
      method: 'PATCH',
      body: JSON.stringify({ campaignId, status }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    setFeedback(`Status změněn na ${status}.`);
    await load();
  }

  async function runDraw(campaignId: string) {
    if (!confirm('Spustit losování? Tato akce je nevratná.')) return;
    setError(null);
    setFeedback(null);
    const res = await authFetch(`/api/admin/lottery/${campaignId}/draw`, { method: 'POST' });
    const j = (await res.json().catch(() => ({}))) as {
      winners?: number;
      losers?: number;
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      setError(j.message ?? j.error ?? `HTTP ${res.status}`);
      return;
    }
    setFeedback(`Vylosováno: ${j.winners ?? 0} výherců, ${j.losers ?? 0} nevýherců.`);
    await load();
  }

  async function runAdvance(campaignId: string) {
    setError(null);
    setFeedback(null);
    const res = await authFetch(`/api/admin/lottery/${campaignId}/advance`, { method: 'POST' });
    const j = (await res.json().catch(() => ({}))) as {
      newWinners?: number;
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      setError(j.message ?? j.error ?? `HTTP ${res.status}`);
      return;
    }
    setFeedback(`Posunuto ${j.newWinners ?? 0} náhradníků.`);
    await load();
  }

  const activeCampaign = campaigns[0] ?? null;
  const showCreateForm = !activeCampaign || activeCampaign.status === 'draft';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Losování"
        description="Pro přetížené akce — spravedlivý výběr zájemců."
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

      {showCreateForm ? (
        <Card>
          <CardHeader>
            <CardTitle>Nastavení losování</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createCampaign} className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  Typ vstupenky (volitelné)
                </label>
                <select
                  value={ticketTypeId}
                  onChange={(e) => setTicketTypeId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— Všechny typy —</option>
                  {ticketTypes.map((tt) => (
                    <option key={tt.id} value={tt.id}>{tt.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  Počet výherců
                </label>
                <Input
                  type="number"
                  min={1}
                  value={maxWinners}
                  onChange={(e) => setMaxWinners(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  Platební lhůta (hodiny)
                </label>
                <Input
                  type="number"
                  min={1}
                  max={720}
                  value={paymentWindowHours}
                  onChange={(e) => setPaymentWindowHours(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  Registrace od (volitelné)
                </label>
                <Input
                  type="datetime-local"
                  value={registrationOpens}
                  onChange={(e) => setRegistrationOpens(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  Registrace do *
                </label>
                <Input
                  type="datetime-local"
                  value={registrationCloses}
                  onChange={(e) => setRegistrationCloses(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  Datum losování *
                </label>
                <Input
                  type="datetime-local"
                  value={drawAt}
                  onChange={(e) => setDrawAt(e.target.value)}
                  required
                />
              </div>
              <div className="md:col-span-2 flex gap-2">
                <Button type="submit" disabled={busy}>
                  {busy ? 'Vytvářím…' : 'Vytvořit losování'}
                </Button>
                {activeCampaign?.status === 'draft' ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => patchStatus(activeCampaign.id, 'open')}
                  >
                    Otevřít registraci
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {campaigns.map((campaign) => {
        const expiredCount = campaign.entries.filter((e) => e.status === 'expired').length;
        const wonCount = campaign.entries.filter((e) => e.status === 'won').length;
        const convertedCount = campaign.entries.filter((e) => e.status === 'converted').length;

        return (
          <div key={campaign.id} className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Kampaň</CardTitle>
                  <StatusBadge status={campaign.status} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-md bg-muted/40 p-3 text-center">
                    <div className="text-2xl font-bold tabular-nums">{campaign.entry_count}</div>
                    <div className="text-xs text-muted-foreground">Zapsáno</div>
                  </div>
                  <div className="rounded-md bg-muted/40 p-3 text-center">
                    <div className="text-2xl font-bold tabular-nums text-yellow-700">{wonCount}</div>
                    <div className="text-xs text-muted-foreground">Výherci</div>
                  </div>
                  <div className="rounded-md bg-muted/40 p-3 text-center">
                    <div className="text-2xl font-bold tabular-nums text-rose-700">{expiredCount}</div>
                    <div className="text-xs text-muted-foreground">Propadlé</div>
                  </div>
                  <div className="rounded-md bg-muted/40 p-3 text-center">
                    <div className="text-2xl font-bold tabular-nums text-emerald-700">{convertedCount}</div>
                    <div className="text-xs text-muted-foreground">Zaplaceno</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {campaign.status === 'open' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => patchStatus(campaign.id, 'closed')}
                    >
                      Uzavřít registraci
                    </Button>
                  ) : null}
                  {campaign.status === 'closed' ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => runDraw(campaign.id)}
                    >
                      Spustit losování
                    </Button>
                  ) : null}
                  {(campaign.status === 'drawn' || campaign.status === 'completed') && expiredCount > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => runAdvance(campaign.id)}
                    >
                      Posunout náhradníky ({expiredCount})
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            {campaign.entries.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Přihlášení ({campaign.entries.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                          <th className="pb-2 pr-3">Email</th>
                          <th className="pb-2 pr-3">Jméno</th>
                          <th className="pb-2 pr-3">Status</th>
                          <th className="pb-2 pr-3">Platební lhůta</th>
                          <th className="pb-2">Objednávka</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaign.entries.map((entry) => (
                          <tr key={entry.id} className="border-b">
                            <td className="py-1.5 pr-3 text-xs">{entry.email}</td>
                            <td className="py-1.5 pr-3 text-xs">{entry.name ?? '—'}</td>
                            <td className="py-1.5 pr-3">
                              <EntryStatusBadge status={entry.status} />
                            </td>
                            <td className="py-1.5 pr-3 text-xs text-muted-foreground">
                              {entry.payment_deadline
                                ? new Date(entry.payment_deadline).toLocaleString('cs-CZ', {
                                    day: 'numeric',
                                    month: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : '—'}
                            </td>
                            <td className="py-1.5 text-xs text-muted-foreground">
                              {entry.order_id ? entry.order_id.slice(0, 8) + '…' : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        );
      })}

      {campaigns.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Zatím žádná losovací kampaň. Vytvořte ji výše.
        </p>
      ) : null}
    </div>
  );
}
