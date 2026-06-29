'use client';

import { use, useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface TicketType {
  id: string;
  name: string;
  base_price: number;
  remaining_qty: number;
}

interface Tier {
  minQty: number;
  discountPct: number;
  freeQty: number;
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

function formatCzk(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

export default function VolumeDiscountsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: eventId } = use(params);
  const [types, setTypes] = useState<TicketType[]>([]);
  const [tiersByType, setTiersByType] = useState<Record<string, Tier[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void load();
    async function load(): Promise<void> {
      try {
        const ttRes = await authFetch(`/api/events/${eventId}/ticket-types`);
        if (!ttRes.ok) {
          setError(`Načtení ticket types selhalo: HTTP ${ttRes.status}`);
          return;
        }
        const j = (await ttRes.json()) as {
          ticketTypes?: TicketType[];
          types?: TicketType[];
        };
        const list = j.ticketTypes ?? j.types ?? [];
        setTypes(list);

        const all: Record<string, Tier[]> = {};
        for (const tt of list) {
          const r = await authFetch(`/api/admin/ticket-types/${tt.id}/volume-discount`);
          if (r.ok) {
            const dat = (await r.json()) as { tiers: Array<Tier & { id?: string; active?: boolean }> };
            all[tt.id] = (dat.tiers ?? []).map((t) => ({
              minQty: t.minQty,
              discountPct: t.discountPct,
              freeQty: t.freeQty ?? 0,
            }));
          } else {
            all[tt.id] = [];
          }
        }
        setTiersByType(all);
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [eventId]);

  function setTierMode(ttId: string, idx: number, mode: 'discount' | 'bogo'): void {
    setTiersByType((prev) => {
      const list = [...(prev[ttId] ?? [])];
      if (mode === 'bogo') {
        list[idx] = { ...list[idx], discountPct: 0, freeQty: list[idx].freeQty > 0 ? list[idx].freeQty : 1 };
      } else {
        list[idx] = { ...list[idx], freeQty: 0, discountPct: list[idx].discountPct > 0 ? list[idx].discountPct : 10 };
      }
      return { ...prev, [ttId]: list };
    });
  }

  function updateTier(ttId: string, idx: number, key: keyof Tier, value: number): void {
    setTiersByType((prev) => {
      const list = [...(prev[ttId] ?? [])];
      list[idx] = { ...list[idx], [key]: value };
      return { ...prev, [ttId]: list };
    });
  }

  function addTier(ttId: string): void {
    setTiersByType((prev) => ({
      ...prev,
      [ttId]: [...(prev[ttId] ?? []), { minQty: 5, discountPct: 10, freeQty: 0 }],
    }));
  }

  function removeTier(ttId: string, idx: number): void {
    setTiersByType((prev) => ({
      ...prev,
      [ttId]: (prev[ttId] ?? []).filter((_, i) => i !== idx),
    }));
  }

  async function saveTiers(ttId: string): Promise<void> {
    setBusy(ttId);
    setError(null);
    setSuccess(null);
    try {
      const sorted = [...(tiersByType[ttId] ?? [])].sort((a, b) => a.minQty - b.minQty);
      const res = await authFetch(`/api/admin/ticket-types/${ttId}/volume-discount`, {
        method: 'PUT',
        body: JSON.stringify({ tiers: sorted }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(`Uloženo (${sorted.length} tieru).`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Skupinová sleva (volume discount)"
        description="Pravidla per ticket type: od X kusů sleva Y %. Aplikuje se v checkoutu PŘED promo kódem. Vyhrává tier s nejvyšším min_qty <= quantity."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      {types.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Žádné ticket types pro tuto akci. Vytvoř ticket type a pak nastav volume discount.
          </CardContent>
        </Card>
      ) : (
        types.map((tt) => {
          const tiers = tiersByType[tt.id] ?? [];
          return (
            <Card key={tt.id}>
              <CardHeader>
                <CardTitle>
                  {tt.name}{' '}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    cena: {formatCzk(tt.base_price)} · zbývá {tt.remaining_qty} ks
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {tiers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Žádné tieru. Přidej první.</p>
                ) : (
                  <div className="space-y-2">
                    {tiers.map((tier, idx) => {
                      const isBogo = tier.freeQty > 0;
                      const exampleQty = tier.minQty;
                      const exampleDiscount = isBogo
                        ? tt.base_price * Math.min(tier.freeQty, exampleQty - tier.minQty + tier.freeQty)
                        : Math.floor((tt.base_price * exampleQty * tier.discountPct) / 100);
                      return (
                        <div key={idx} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
                          <div>
                            <label className="block text-[11px] uppercase text-muted-foreground">
                              Od kusů
                            </label>
                            <Input
                              type="number"
                              min={2}
                              max={1000}
                              value={tier.minQty}
                              onChange={(e) =>
                                updateTier(tt.id, idx, 'minQty', Number(e.target.value) || 2)
                              }
                              className="w-24"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] uppercase text-muted-foreground">
                              Typ slevy
                            </label>
                            <select
                              value={isBogo ? 'bogo' : 'discount'}
                              onChange={(e) =>
                                setTierMode(tt.id, idx, e.target.value as 'discount' | 'bogo')
                              }
                              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                            >
                              <option value="discount">Sleva %</option>
                              <option value="bogo">Bezplatné vstupenky (BOGO)</option>
                            </select>
                          </div>
                          {isBogo ? (
                            <div>
                              <label className="block text-[11px] uppercase text-muted-foreground">
                                Zdarma ks
                              </label>
                              <Input
                                type="number"
                                min={1}
                                max={20}
                                value={tier.freeQty}
                                onChange={(e) =>
                                  updateTier(tt.id, idx, 'freeQty', Number(e.target.value) || 1)
                                }
                                className="w-20"
                              />
                            </div>
                          ) : (
                            <div>
                              <label className="block text-[11px] uppercase text-muted-foreground">
                                Sleva %
                              </label>
                              <Input
                                type="number"
                                min={1}
                                max={90}
                                value={tier.discountPct}
                                onChange={(e) =>
                                  updateTier(tt.id, idx, 'discountPct', Number(e.target.value) || 1)
                                }
                                className="w-20"
                              />
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground">
                            {isBogo
                              ? `Kup ${exampleQty}, dostaneš ${tier.freeQty} zdarma → ušetříš ${formatCzk(exampleDiscount)}`
                              : `Při ${exampleQty} ks → sleva ${formatCzk(exampleDiscount)} z ${formatCzk(tt.base_price * exampleQty)}`}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeTier(tt.id, idx)}
                            className="ml-auto text-xs text-rose-700 hover:underline"
                          >
                            Smazat
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => addTier(tt.id)}>
                    + Přidat tier
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => saveTiers(tt.id)}
                    disabled={busy === tt.id}
                  >
                    {busy === tt.id ? 'Ukládám…' : 'Uložit pro tento typ'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          <strong>Jak to funguje:</strong> Pokud kupec přidá ≥ minQty kusů daného typu
          do košíku, sleva se aplikuje na subtotal (unit_price × quantity). Tier s
          nejvyšším min_qty &le; quantity vyhrává. Promo kód se případně aplikuje
          POTÉ na zlevněný subtotal.
        </CardContent>
      </Card>
    </div>
  );
}
