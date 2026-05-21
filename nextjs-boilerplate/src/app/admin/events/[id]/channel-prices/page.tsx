'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Plus, Trash2, Layers } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, typedFetch, TypedFetchError } from '@/lib/typed-fetch';

interface Override {
  id: string;
  ticket_type_id: string;
  ticket_type_name: string;
  channel_key: string;
  price_override: number;
  default_price: number;
  fee_pct_override: number | null;
}

interface Channel {
  channel_key: string;
  display_name: string;
}

interface TicketType {
  id: string;
  name: string;
  base_price: number;
}

function fmt(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

export default function ChannelPricesPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [overrides, setOverrides] = useState<Override[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ticketTypeId, setTicketTypeId] = useState('');
  const [channelKey, setChannelKey] = useState('box_office');
  const [priceKc, setPriceKc] = useState('');

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load(): Promise<void> {
    try {
      const [cp, tt] = await Promise.all([
        typedGet<{ overrides: Override[]; availableChannels: Channel[] }>(
          `/api/admin/events/${eventId}/channel-prices`,
        ),
        typedGet<{ ticketTypes: TicketType[] }>(`/api/admin/events/${eventId}/ticket-types`)
          .catch(() => ({ ticketTypes: [] })),
      ]);
      setOverrides(cp.overrides ?? []);
      setChannels(cp.availableChannels ?? []);
      setTicketTypes(tt.ticketTypes ?? []);
      if (!ticketTypeId && tt.ticketTypes?.length) setTicketTypeId(tt.ticketTypes[0].id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await typedPost(`/api/admin/events/${eventId}/channel-prices`, {
        ticketTypeId, channelKey,
        priceOverride: Math.round(Number(priceKc) * 100),
      }, { throwOnError: true });
      setShowForm(false);
      setPriceKc('');
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

  async function remove(overrideId: string): Promise<void> {
    try {
      await typedFetch(`/api/admin/events/${eventId}/channel-prices?overrideId=${overrideId}`, {
        method: 'DELETE', throwOnError: true,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  // Build matrix: rows = ticket types, cols = channels
  const matrix = ticketTypes.map((tt) => {
    const channelPrices: Record<string, Override | null> = {};
    for (const ch of channels) {
      channelPrices[ch.channel_key] = overrides.find(
        (o) => o.ticket_type_id === tt.id && o.channel_key === ch.channel_key,
      ) ?? null;
    }
    return { ticketType: tt, channelPrices };
  });

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Channel pricing"
        description="Různé ceny per prodejní kanál (Eventim-style). Box office bez online fee, partner přes 6 %, atd."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      ) : null}

      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">
          {overrides.length} channel override{overrides.length === 1 ? '' : 'ů'} aktivních
        </p>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Zavřít' : '+ Nový override'}
        </Button>
      </div>

      {showForm ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Ticket type</label>
                <select
                  value={ticketTypeId}
                  onChange={(e) => setTicketTypeId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {ticketTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({fmt(t.base_price)})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Kanál</label>
                <select
                  value={channelKey}
                  onChange={(e) => setChannelKey(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {channels.map((ch) => (
                    <option key={ch.channel_key} value={ch.channel_key}>
                      {ch.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Cena (Kč)</label>
                <Input
                  type="number"
                  step="1"
                  value={priceKc}
                  onChange={(e) => setPriceKc(e.target.value)}
                  placeholder="450"
                />
              </div>
            </div>
            <Button onClick={create} disabled={busy || !ticketTypeId || !priceKc}>
              <Plus className="mr-1 h-4 w-4" />
              {busy ? 'Ukládám…' : 'Uložit override'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Matrix */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Cenová matice
          </CardTitle>
          <CardDescription>
            Buňka bez overridu = default cena ticket type. Buňka s číslem = channel override.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ticketTypes.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Žádné ticket types.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-2">Ticket type</th>
                    {channels.map((ch) => (
                      <th key={ch.channel_key} className="pb-2 text-right">{ch.display_name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.map(({ ticketType, channelPrices }) => (
                    <tr key={ticketType.id} className="border-t">
                      <td className="py-2 font-medium">{ticketType.name}</td>
                      {channels.map((ch) => {
                        const o = channelPrices[ch.channel_key];
                        return (
                          <td key={ch.channel_key} className="py-2 text-right">
                            {o ? (
                              <div className="inline-flex items-center gap-2">
                                <span className="font-semibold text-emerald-700">
                                  {fmt(o.price_override)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => remove(o.id)}
                                  className="text-rose-600 hover:text-rose-800"
                                  aria-label="Odstranit override"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">{fmt(ticketType.base_price)}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
