'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight, Package } from 'lucide-react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/format';

interface TicketType {
  id: string;
  name: string;
  priceHalire: number;
}

interface Addon {
  id: string;
  name: string;
  category: string;
  priceHalire: number;
}

interface Bundle {
  id: string;
  name: string;
  description: string | null;
  ticketTypeId: string;
  ticketTypeName: string;
  discountPct: number;
  active: boolean;
  addonCount: number;
  grossPriceHalire: number;
  finalPriceHalire: number;
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

const CATEGORY_LABELS: Record<string, string> = {
  parking: '🅿️ Parking', camping: '⛺ Camping', food: '🍔 Jídlo',
  drink: '🍺 Pití', merch: '👕 Merch', transport: '🚌 Doprava',
  accommodation: '🛏️ Ubytování', insurance: '🛡️ Pojištění',
  upgrade: '⭐ Upgrade', other: '📦 Jiné',
};

export default function BundlesPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '',
    description: '',
    ticketTypeId: '',
    discountPct: 0,
    selectedAddons: [] as { addonId: string; quantity: number }[],
  });

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load() {
    const [bRes, ttRes, aRes] = await Promise.all([
      authFetch(`/api/admin/events/${eventId}/bundles`),
      authFetch(`/api/admin/events/${eventId}/ticket-types`),
      authFetch(`/api/admin/events/${eventId}/addons`),
    ]);
    if (bRes.ok) {
      const j = (await bRes.json()) as { bundles: Bundle[] };
      setBundles(j.bundles ?? []);
    }
    if (ttRes.ok) {
      const j = (await ttRes.json()) as { ticketTypes: TicketType[] };
      setTicketTypes(j.ticketTypes ?? []);
    }
    if (aRes.ok) {
      const j = (await aRes.json()) as { addons: Addon[] };
      setAddons(j.addons ?? []);
    }
  }

  async function toggleActive(bundle: Bundle) {
    await authFetch(`/api/admin/events/${eventId}/bundles/${bundle.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !bundle.active }),
    });
    void load();
  }

  async function deleteBundle(id: string) {
    if (!confirm('Smazat bundle?')) return;
    await authFetch(`/api/admin/events/${eventId}/bundles/${id}`, { method: 'DELETE' });
    void load();
  }

  function toggleAddon(addonId: string) {
    setForm((f) => {
      const exists = f.selectedAddons.find((a) => a.addonId === addonId);
      if (exists) {
        return { ...f, selectedAddons: f.selectedAddons.filter((a) => a.addonId !== addonId) };
      }
      return { ...f, selectedAddons: [...f.selectedAddons, { addonId, quantity: 1 }] };
    });
  }

  function setAddonQty(addonId: string, qty: number) {
    setForm((f) => ({
      ...f,
      selectedAddons: f.selectedAddons.map((a) =>
        a.addonId === addonId ? { ...a, quantity: Math.max(1, qty) } : a,
      ),
    }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.ticketTypeId) { setError('Vyber typ vstupenky'); return; }
    if (form.selectedAddons.length === 0) { setError('Přidej alespoň jeden add-on'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/bundles`, {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          ticketTypeId: form.ticketTypeId,
          addons: form.selectedAddons,
          discountPct: form.discountPct,
        }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setShowForm(false);
      setForm({ name: '', description: '', ticketTypeId: '', discountPct: 0, selectedAddons: [] });
      void load();
    } finally {
      setSaving(false);
    }
  }

  const selectedTt = ticketTypes.find((t) => t.id === form.ticketTypeId);
  const addonsTotal = form.selectedAddons.reduce((sum, sa) => {
    const addon = addons.find((a) => a.id === sa.addonId);
    return sum + (addon ? addon.priceHalire * sa.quantity : 0);
  }, 0);
  const grossPreview = (selectedTt?.priceHalire ?? 0) + addonsTotal;
  const finalPreview = Math.floor(grossPreview * (1 - form.discountPct / 100));

  return (
    <div className="space-y-6">
      <PageHeader
        title="VIP & Merch Bundles"
        description="Balíčky = vstupenka + doplňky (merch, upgrade, jídlo…) se slevou. Kupující vybere bundle v checkout namísto jednotlivých položek."
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus className="mr-2 h-4 w-4" />
            Nový bundle
          </Button>
        }
      />

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Nový bundle</CardTitle>
            <CardDescription>
              Vyber typ vstupenky, přidej doplňky a nastav slevu na celkovou cenu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => { void submit(e); }} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Název *</label>
                  <Input
                    placeholder="VIP balíček"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Sleva (%)</label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={form.discountPct}
                    onChange={(e) => setForm((f) => ({ ...f, discountPct: Number(e.target.value) }))}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Popis</label>
                <Input
                  placeholder="Co je součástí balíčku…"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Typ vstupenky *</label>
                {ticketTypes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nejprve vytvoř typy vstupenek v Tickets.</p>
                ) : (
                  <select
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.ticketTypeId}
                    onChange={(e) => setForm((f) => ({ ...f, ticketTypeId: e.target.value }))}
                    required
                  >
                    <option value="">— vyber —</option>
                    {ticketTypes.map((tt) => (
                      <option key={tt.id} value={tt.id}>
                        {tt.name} ({formatMoney(tt.priceHalire)})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Add-ony v balíčku *</label>
                {addons.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nejprve vytvoř add-ony v sekci{' '}
                    <a href={`/admin/events/${eventId}/addons`} className="underline">
                      Add-ons
                    </a>
                    .
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {addons.map((addon) => {
                      const sel = form.selectedAddons.find((a) => a.addonId === addon.id);
                      return (
                        <div
                          key={addon.id}
                          className={`flex items-center gap-3 rounded-md border p-3 ${sel ? 'border-primary bg-primary/5' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={!!sel}
                            onChange={() => toggleAddon(addon.id)}
                            className="h-4 w-4 flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">
                              {CATEGORY_LABELS[addon.category] ?? addon.category} {addon.name}
                            </div>
                            <div className="text-xs text-muted-foreground">{formatMoney(addon.priceHalire)}</div>
                          </div>
                          {sel && (
                            <Input
                              type="number"
                              min={1}
                              max={20}
                              value={sel.quantity}
                              onChange={(e) => setAddonQty(addon.id, Number(e.target.value))}
                              className="w-16 text-center"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {grossPreview > 0 && (
                <div className="rounded-md bg-muted p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Celkem bez slevy</span>
                    <span>{formatMoney(grossPreview)}</span>
                  </div>
                  {form.discountPct > 0 && (
                    <div className="flex justify-between font-semibold text-emerald-700">
                      <span>Cena balíčku (−{form.discountPct}%)</span>
                      <span>{formatMoney(finalPreview)}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Ukládám…' : 'Vytvořit bundle'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Zrušit
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {bundles.length === 0 && !showForm ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Zatím žádné bundles. Vytvoř první VIP nebo merch balíček.
            </p>
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nový bundle
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {bundles.map((b) => (
            <Card key={b.id} className={b.active ? '' : 'opacity-60'}>
              <CardContent className="flex items-start gap-4 p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{b.name}</span>
                    {!b.active && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                        neaktivní
                      </span>
                    )}
                    {b.discountPct > 0 && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">
                        −{b.discountPct}%
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {b.ticketTypeName} + {b.addonCount} add-on{b.addonCount !== 1 ? 'y' : ''}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-sm">
                    {b.discountPct > 0 && (
                      <span className="text-muted-foreground line-through">
                        {formatMoney(b.grossPriceHalire)}
                      </span>
                    )}
                    <span className="font-semibold text-emerald-700">
                      {formatMoney(b.finalPriceHalire)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => { void toggleActive(b); }}
                    className="rounded p-1.5 hover:bg-muted"
                    title={b.active ? 'Deaktivovat' : 'Aktivovat'}
                  >
                    {b.active
                      ? <ToggleRight className="h-5 w-5 text-emerald-600" />
                      : <ToggleLeft className="h-5 w-5 text-slate-400" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => { void deleteBundle(b.id); }}
                    className="rounded p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    title="Smazat"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
