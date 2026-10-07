'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import { Heart, Target, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface TicketType { id: string; name: string; is_donation?: boolean; }
interface Campaign {
  id: string; ticket_type_id: string; name: string; description: string | null;
  goal_hellers: number | null; min_amount_hellers: number; max_amount_hellers: number | null;
  total_raised_hellers: number; donor_count: number;
  beneficiary_org_name: string | null; thank_you_message: string | null;
  is_active: boolean;
}

function fmtKc(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

export default function DonationPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [ticketTypeId, setTicketTypeId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [goalKc, setGoalKc] = useState('');
  const [minAmountKc, setMinAmountKc] = useState('1');
  const [maxAmountKc, setMaxAmountKc] = useState('');
  const [beneficiary, setBeneficiary] = useState('');
  const [thankYou, setThankYou] = useState('');

  useEffect(() => { void load(); }, [eventId]);

  async function load(): Promise<void> {
    try {
      const [c, tt] = await Promise.all([
        typedGet<{ campaigns: Campaign[] }>(`/api/admin/events/${eventId}/donation-campaign`),
        typedGet<{ ticketTypes: TicketType[] }>(`/api/admin/events/${eventId}/ticket-types`).catch(() => ({ ticketTypes: [] })),
      ]);
      setCampaigns(c.campaigns ?? []);
      setTicketTypes(tt.ticketTypes ?? []);
      if (!ticketTypeId && tt.ticketTypes?.length) setTicketTypeId(tt.ticketTypes[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await typedPost(`/api/admin/events/${eventId}/donation-campaign`, {
        ticketTypeId,
        name,
        description: description || undefined,
        goalHalire: goalKc ? Math.round(Number(goalKc) * 100) : undefined,
        minAmountHalire: Math.round(Number(minAmountKc) * 100),
        maxAmountHalire: maxAmountKc ? Math.round(Number(maxAmountKc) * 100) : undefined,
        beneficiaryOrgName: beneficiary || undefined,
        thankYouMessage: thankYou || undefined,
      }, { throwOnError: true });
      setShowForm(false);
      setName(''); setDescription(''); setGoalKc(''); setBeneficiary(''); setThankYou('');
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

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Donation kampaně"
        description="Pay-what-you-want lístky pro neziskové organizace. Buyer si v checkoutu zvolí částku."
      />

      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}

      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">{campaigns.length} kampaní</p>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Zavřít' : '+ Nová kampaň'}</Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Heart className="h-5 w-5 text-rose-500" /> Nová kampaň</CardTitle>
            <CardDescription>Vyber ticket_type (bude označen jako donation = pay-what-you-want)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Ticket type *</label>
              <select value={ticketTypeId} onChange={(e) => setTicketTypeId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                {ticketTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Název kampaně *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="např. Pomáhajme Ukrajině" maxLength={200} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Popis</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                rows={3} maxLength={2000}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Cíl (Kč, volitelně)</label>
                <Input type="number" value={goalKc} onChange={(e) => setGoalKc(e.target.value)} placeholder="100000" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Min částka (Kč)</label>
                <Input type="number" value={minAmountKc} onChange={(e) => setMinAmountKc(e.target.value)} min="1" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Max částka (Kč)</label>
                <Input type="number" value={maxAmountKc} onChange={(e) => setMaxAmountKc(e.target.value)} placeholder="unlimited" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Beneficiary organizace</label>
              <Input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)}
                placeholder="např. Člověk v tísni" maxLength={200} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Thank-you zpráva</label>
              <Input value={thankYou} onChange={(e) => setThankYou(e.target.value)}
                placeholder="Děkujeme za podporu!" maxLength={1000} />
            </div>
            <Button onClick={create} disabled={busy || !name || !ticketTypeId}>
              {busy ? 'Ukládám…' : '💖 Vytvořit kampaň'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Heart className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Žádné donation kampaně. Vytvoř první pro neziskovou organizaci nebo charity event.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => {
            const pct = c.goal_hellers ? Math.min(100, (c.total_raised_hellers / c.goal_hellers) * 100) : 0;
            return (
              <Card key={c.id} className={!c.is_active ? 'opacity-60' : ''}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>{c.name}</span>
                    {c.is_active ? null : <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs">inactive</span>}
                  </CardTitle>
                  {c.description ? <CardDescription>{c.description}</CardDescription> : null}
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Vybráno</p>
                      <p className="font-bold">{fmtKc(c.total_raised_hellers)}</p>
                    </div>
                    {c.goal_hellers ? (
                      <div>
                        <p className="text-xs text-muted-foreground">Cíl</p>
                        <p className="font-bold">{fmtKc(c.goal_hellers)}</p>
                      </div>
                    ) : null}
                    <div>
                      <p className="text-xs text-muted-foreground">Dárci</p>
                      <p className="font-bold">{c.donor_count}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Min</p>
                      <p className="font-bold">{fmtKc(c.min_amount_hellers)}</p>
                    </div>
                  </div>
                  {c.goal_hellers ? (
                    <div className="mt-4">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-rose-500" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        <Target className="inline h-3 w-3" /> {pct.toFixed(0)} % cíle dosaženo
                      </p>
                    </div>
                  ) : null}
                  {c.beneficiary_org_name ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Beneficiary: <strong>{c.beneficiary_org_name}</strong>
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="border-blue-200 bg-blue-50/30">
        <CardContent className="flex gap-3 pt-6">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-blue-700" />
          <div className="text-sm">
            <p className="font-semibold text-blue-900">Jak donation funguje</p>
            <p className="mt-1 text-blue-800">
              Vybraný ticket_type bude označen jako <code>is_donation=true</code>. V checkoutu se buyer
              zobrazí input s min/max částkou (pay-what-you-want). Suma se přičte do
              <code> total_raised_hellers</code> kampaně.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
