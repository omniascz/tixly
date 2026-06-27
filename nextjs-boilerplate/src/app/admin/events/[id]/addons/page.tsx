'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Addon {
  id: string;
  name: string;
  description: string | null;
  category: string;
  priceHalire: number;
  maxQuantity: number;
  stockAvailable: number | null;
  imageUrl: string | null;
  available: boolean;
  displayOrder: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  parking: '🅿️ Parking',
  camping: '⛺ Camping',
  food: '🍔 Jídlo',
  drink: '🍺 Pití',
  merch: '👕 Merch',
  transport: '🚌 Doprava',
  accommodation: '🛏️ Ubytování',
  insurance: '🛡️ Pojištění',
  upgrade: '⭐ Upgrade',
  other: '📦 Jiné',
};

export default function EventAddonsPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [list, setList] = useState<Addon[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('parking');
  const [priceCzk, setPriceCzk] = useState('200');
  const [maxQuantity, setMaxQuantity] = useState('1');
  const [stock, setStock] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  async function reload() {
    const token = localStorage.getItem('accessToken');
    const r = await fetch(`/api/admin/events/${eventId}/addons`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (r.ok) {
      const d = (await r.json()) as { addons: Addon[] };
      setList(d.addons);
    }
  }

  useEffect(() => {
    void reload();
  }, [eventId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const r = await fetch(`/api/admin/events/${eventId}/addons`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name,
          description: description || null,
          category,
          priceHalire: Math.round(parseFloat(priceCzk) * 100),
          maxQuantity: parseInt(maxQuantity, 10),
          stockAvailable: stock ? parseInt(stock, 10) : null,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.message ?? d.error ?? `HTTP ${r.status}`);
        return;
      }
      setFeedback(`Add-on "${name}" přidán.`);
      setName('');
      setDescription('');
      setStock('');
      setShowForm(false);
      await reload();
    } catch {
      setError('Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  async function toggleAvailable(addon: Addon) {
    const token = localStorage.getItem('accessToken');
    await fetch(`/api/admin/events/${eventId}/addons/${addon.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ available: !addon.available }),
    });
    await reload();
  }

  async function handleDelete(addon: Addon) {
    if (!window.confirm(`Smazat "${addon.name}"?`)) return;
    const token = localStorage.getItem('accessToken');
    const r = await fetch(`/api/admin/events/${eventId}/addons/${addon.id}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) {
      const d = await r.json();
      setError(d.message ?? d.error);
    } else {
      setFeedback(`"${addon.name}" smazáno.`);
      await reload();
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add-ons k akci"
        description="Parking, camping, F&B kredity, merch — kupec si je přidá v checkoutu."
        actions={
          <Link
            href={`/admin/events`}
            className="text-xs text-primary hover:underline"
          >
            ← Zpět na akce
          </Link>
        }
      />

      {/* Fan spending benchmarks */}
      <div className="grid grid-cols-3 gap-3 rounded-xl border bg-gradient-to-r from-violet-50 to-emerald-50 p-4 text-center">
        <div>
          <div className="text-2xl font-extrabold text-violet-700">58%</div>
          <div className="mt-0.5 text-xs text-muted-foreground">fanoušků kupuje<br/>add-on produkty</div>
        </div>
        <div>
          <div className="text-2xl font-extrabold text-emerald-700">$300</div>
          <div className="mt-0.5 text-xs text-muted-foreground">průměrný extra<br/>výdaj nad vstupenku</div>
        </div>
        <div>
          <div className="text-2xl font-extrabold text-blue-700">30%</div>
          <div className="mt-0.5 text-xs text-muted-foreground">fanoušků cestuje<br/>na akci</div>
        </div>
      </div>

      {feedback ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
          {feedback}
        </p>
      ) : null}

      {!showForm ? (
        <Button onClick={() => setShowForm(true)} className="gap-1">
          <Plus className="h-4 w-4" /> Nový add-on
        </Button>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Nový add-on</CardTitle>
            <CardDescription>
              Cokoliv, co kupec přidá k lístku — parking, camping, F&B kredit, merch bundle…
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">Název *</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Parking 3 dny"
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">Popis (volit.)</label>
                <textarea
                  className="flex min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Garantované místo na parkovišti P1, vstup pátek 12:00."
                  maxLength={1000}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Kategorie</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Cena (Kč)</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={priceCzk}
                  onChange={(e) => setPriceCzk(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Max ks na objednávku</label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={maxQuantity}
                  onChange={(e) => setMaxQuantity(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Sklad (volit. — kapacita)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  placeholder="bez limitu"
                />
              </div>
              {error ? (
                <p className="md:col-span-2 text-sm text-destructive">{error}</p>
              ) : null}
              <div className="md:col-span-2 flex gap-2">
                <Button type="submit" disabled={loading}>
                  {loading ? 'Přidávám…' : 'Přidat add-on'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Zrušit
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Aktivní add-ons ({list.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Žádné add-ons. Kupec při checkoutu nedostane checklist.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Název</th>
                  <th>Kategorie</th>
                  <th className="text-right">Cena</th>
                  <th>Max</th>
                  <th>Sklad</th>
                  <th>Stav</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id} className="border-b">
                    <td className="py-2">
                      <div className="font-medium">{a.name}</div>
                      {a.description ? (
                        <div className="text-xs text-muted-foreground">{a.description}</div>
                      ) : null}
                    </td>
                    <td className="text-xs">
                      {CATEGORY_LABELS[a.category] ?? a.category}
                    </td>
                    <td className="text-right font-medium">
                      {(a.priceHalire / 100).toLocaleString('cs-CZ')} Kč
                    </td>
                    <td>{a.maxQuantity}</td>
                    <td className="text-xs">
                      {a.stockAvailable === null
                        ? '∞'
                        : a.stockAvailable.toLocaleString('cs-CZ')}
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleAvailable(a)}
                        title="Toggle"
                      >
                        {a.available ? (
                          <ToggleRight className="h-4 w-4 text-emerald-700" />
                        ) : (
                          <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-rose-700 hover:bg-rose-50"
                        onClick={() => handleDelete(a)}
                        title="Smazat"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
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
