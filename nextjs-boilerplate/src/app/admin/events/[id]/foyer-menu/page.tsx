'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  priceHalire: number;
  category: string;
  availableCount: number | null;
  imageUrl: string | null;
  orderIndex: number;
  isActive: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  napoje: 'Nápoje',
  jidlo: 'Jídlo',
  dezerty: 'Dezerty',
  ostatni: 'Ostatní',
};

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default function FoyerMenuPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [items, setItems] = useState<MenuItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceCzk, setPriceCzk] = useState('');
  const [category, setCategory] = useState<string>('napoje');
  const [availableCount, setAvailableCount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function reload() {
    const r = await fetch(`/api/admin/events/${eventId}/foyer-menu`, {
      headers: authHeaders(),
    });
    if (r.ok) {
      const d = (await r.json()) as { items: MenuItem[] };
      setItems(d.items);
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
      const priceNum = parseFloat(priceCzk.replace(',', '.'));
      if (isNaN(priceNum) || priceNum < 0) {
        setError('Neplatná cena');
        return;
      }
      const r = await fetch(`/api/admin/events/${eventId}/foyer-menu`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name,
          description: description.trim() || null,
          priceHalire: Math.round(priceNum * 100),
          category,
          availableCount: availableCount ? parseInt(availableCount, 10) : null,
        }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setFeedback(`Položka "${name}" přidána.`);
      setName('');
      setDescription('');
      setPriceCzk('');
      setAvailableCount('');
      setShowForm(false);
      await reload();
    } catch {
      setError('Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(item: MenuItem) {
    await fetch(`/api/admin/events/${eventId}/foyer-menu`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ id: item.id, isActive: !item.isActive }),
    });
    await reload();
  }

  async function handleDelete(item: MenuItem) {
    if (!window.confirm(`Smazat "${item.name}"?`)) return;
    const r = await fetch(`/api/admin/events/${eventId}/foyer-menu`, {
      method: 'DELETE',
      headers: authHeaders(),
      body: JSON.stringify({ id: item.id }),
    });
    if (!r.ok) {
      const d = (await r.json()) as { error?: string };
      setError(d.error ?? 'Chyba při mazání');
    } else {
      setFeedback(`"${item.name}" smazáno.`);
      await reload();
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Menu foyer baru"
        description="Nápoje a občerstvení k předobjednání s lístkem."
      />

      {feedback ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
          {feedback}
        </p>
      ) : null}

      {!showForm ? (
        <Button onClick={() => setShowForm(true)} className="gap-1">
          <Plus className="h-4 w-4" /> Přidat položku
        </Button>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Nová položka menu</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">Název *</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Prosecco 0,1 l"
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">Popis (volitelné)</label>
                <textarea
                  className="flex min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Italské prosecco DOC, 0,1 l"
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
                <label className="mb-1 block text-xs font-medium">Cena (Kč) *</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={priceCzk}
                  onChange={(e) => setPriceCzk(e.target.value)}
                  placeholder="90"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Počet kusů (prázdné = neomezeno)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={availableCount}
                  onChange={(e) => setAvailableCount(e.target.value)}
                  placeholder="bez limitu"
                />
              </div>
              {error ? (
                <p className="md:col-span-2 text-sm text-destructive">{error}</p>
              ) : null}
              <div className="md:col-span-2 flex gap-2">
                <Button type="submit" disabled={loading}>
                  {loading ? 'Přidávám…' : 'Přidat položku'}
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
          <CardTitle>Položky menu ({items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Žádné položky. Přidejte nápoje a jídlo pro předobjednávky.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Název</th>
                  <th>Kategorie</th>
                  <th className="text-right">Cena</th>
                  <th>Dostupné</th>
                  <th>Aktivní</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="py-2">
                      <div className="font-medium">{item.name}</div>
                      {item.description ? (
                        <div className="text-xs text-muted-foreground">{item.description}</div>
                      ) : null}
                    </td>
                    <td className="text-xs">{CATEGORY_LABELS[item.category] ?? item.category}</td>
                    <td className="text-right font-medium">
                      {(item.priceHalire / 100).toLocaleString('cs-CZ')} Kč
                    </td>
                    <td className="text-xs">
                      {item.availableCount === null ? '∞' : item.availableCount.toLocaleString('cs-CZ')}
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleActive(item)}
                        title="Přepnout aktivní"
                      >
                        {item.isActive ? (
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
                        onClick={() => handleDelete(item)}
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
