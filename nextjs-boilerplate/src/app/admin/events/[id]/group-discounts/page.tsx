'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import { Plus, Users, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, typedFetch, TypedFetchError } from '@/lib/typed-fetch';

interface TicketType { id: string; name: string; base_price: number; }
interface Tier {
  id: string; ticket_type_id: string; ticket_type_name: string;
  min_quantity: number; label: string;
  discount_pct: number | null; discount_flat_halire: number | null;
}

function fmtKc(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

export default function GroupDiscountsPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ticketTypeId, setTicketTypeId] = useState('');
  const [minQuantity, setMinQuantity] = useState('5');
  const [label, setLabel] = useState('Skupina 5+');
  const [discountPct, setDiscountPct] = useState('10');
  const [useFlat, setUseFlat] = useState(false);
  const [discountFlatKc, setDiscountFlatKc] = useState('');

  useEffect(() => { void load(); }, [eventId]);

  async function load(): Promise<void> {
    try {
      const [t, tt] = await Promise.all([
        typedGet<{ tiers: Tier[] }>(`/api/admin/events/${eventId}/group-discounts`),
        typedGet<{ ticketTypes: TicketType[] }>(`/api/admin/events/${eventId}/ticket-types`).catch(() => ({ ticketTypes: [] })),
      ]);
      setTiers(t.tiers ?? []);
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
      await typedPost(`/api/admin/events/${eventId}/group-discounts`, {
        ticketTypeId,
        minQuantity: Number(minQuantity),
        label,
        discountPct: useFlat ? undefined : Number(discountPct),
        discountFlatHalire: useFlat ? Math.round(Number(discountFlatKc) * 100) : undefined,
      }, { throwOnError: true });
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

  async function remove(tierId: string): Promise<void> {
    if (!confirm('Smazat tier?')) return;
    try {
      await typedFetch(`/api/admin/events/${eventId}/group-discounts?tierId=${tierId}`, {
        method: 'DELETE', throwOnError: true,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  // Group tiers per ticket type
  const tiersByType = ticketTypes.map((tt) => ({
    tt,
    tiers: tiers.filter((t) => t.ticket_type_id === tt.id).sort((a, b) => a.min_quantity - b.min_quantity),
  }));

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Group discounts (skupinové slevy)"
        description="Eventbrite-style kvantity slevy. Eg. 5+ lístků = 10 %, 10+ = 20 %."
      />

      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}

      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">{tiers.length} tierů</p>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Zavřít' : '+ Nový tier'}</Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader><CardTitle>Nový tier</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Ticket type</label>
                <select value={ticketTypeId} onChange={(e) => setTicketTypeId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  {ticketTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({fmtKc(t.base_price)})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Minimum kusů</label>
                <Input type="number" min="2" max="1000" value={minQuantity}
                  onChange={(e) => setMinQuantity(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Popisek (buyer vidí)</label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)}
                placeholder="např. Skupina 5+ se slevou 10 %" maxLength={100} />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-2 text-xs font-medium">
                <input type="checkbox" checked={useFlat} onChange={(e) => setUseFlat(e.target.checked)} />
                Fixní sleva (v Kč) místo procent
              </label>
            </div>
            {useFlat ? (
              <div>
                <label className="mb-1 block text-xs font-medium">Sleva (Kč na lístek)</label>
                <Input type="number" value={discountFlatKc} onChange={(e) => setDiscountFlatKc(e.target.value)} placeholder="50" />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-medium">Sleva (%)</label>
                <Input type="number" min="0" max="95" step="0.5"
                  value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} />
              </div>
            )}
            <Button onClick={create} disabled={busy || !ticketTypeId}>
              <Plus className="mr-1 h-4 w-4" /> {busy ? 'Ukládám…' : 'Přidat tier'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {tiersByType.map(({ tt, tiers: ttTiers }) => (
        <Card key={tt.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              {tt.name} <span className="text-xs text-muted-foreground">({fmtKc(tt.base_price)} základ)</span>
            </CardTitle>
            {ttTiers.length === 0 ? (
              <CardDescription>Žádné slevy. Standardní cena pro všechny.</CardDescription>
            ) : null}
          </CardHeader>
          {ttTiers.length > 0 ? (
            <CardContent>
              <div className="space-y-2">
                {ttTiers.map((tier) => (
                  <div key={tier.id} className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <p className="font-medium">{tier.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {tier.min_quantity}+ kusů ·
                        {tier.discount_pct !== null
                          ? ` -${tier.discount_pct} %`
                          : ` -${fmtKc(tier.discount_flat_halire ?? 0)}`}
                      </p>
                    </div>
                    <button type="button" onClick={() => remove(tier.id)}
                      className="text-rose-600 hover:text-rose-800"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </CardContent>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
