'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface GiftCard {
  id: string;
  code: string;
  initial_value_halire: string;
  remaining_value_halire: string;
  currency: string;
  issued_to_email: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

const VALUE_PRESETS = [20000, 50000, 100000];

function priceLabel(halire: string | number, currency = 'CZK'): string {
  const h = typeof halire === 'string' ? parseInt(halire, 10) : halire;
  if (currency === 'CZK') return `${(h / 100).toFixed(0)} Kč`;
  return `${(h / 100).toFixed(2)} ${currency}`;
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

export default function GiftCardsPage() {
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'expired' | 'used'>('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  // Create form
  const [createValue, setCreateValue] = useState<number | ''>('');
  const [customValue, setCustomValue] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createExpiry, setCreateExpiry] = useState('');
  const [creating, setCreating] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ filter, search });
    void authFetch(`/api/admin/gift-cards?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as { giftCards: GiftCard[] };
        setCards(d.giftCards);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [filter]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    load();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setCreateFeedback(null);
    const valueHalire = createValue !== '' ? Number(createValue) : Number(customValue) * 100;
    if (!valueHalire || valueHalire <= 0) {
      setCreateError('Zadej hodnotu gift karty.');
      setCreating(false);
      return;
    }
    try {
      const res = await authFetch('/api/admin/gift-cards', {
        method: 'POST',
        body: JSON.stringify({
          valueHalire,
          email: createEmail.trim() || undefined,
          expiresAt: createExpiry ? new Date(createExpiry).toISOString() : undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const { code } = (await res.json()) as { code: string };
      setCreateFeedback(`Gift karta vytvořena: ${code}`);
      setShowCreate(false);
      setCreateValue('');
      setCustomValue('');
      setCreateEmail('');
      setCreateExpiry('');
      load();
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gift karty"
        description="Platform-wide prepaid gift karty. Kupující uplatní kód při checkoutu."
        actions={
          <Button onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Zrušit' : '+ Vytvořit gift kartu'}
          </Button>
        }
      />

      {createFeedback ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {createFeedback}
        </div>
      ) : null}

      {showCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Nová gift karta</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => { void handleCreate(e); }} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium">Hodnota</label>
                <div className="flex flex-wrap gap-2">
                  {VALUE_PRESETS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => { setCreateValue(v); setCustomValue(''); }}
                      className={`rounded-md border px-3 py-2 text-sm ${createValue === v ? 'border-primary bg-primary/10 font-semibold' : 'border-border bg-background'}`}
                    >
                      {priceLabel(v)}
                    </button>
                  ))}
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={1}
                      placeholder="Vlastní (Kč)"
                      value={customValue}
                      onChange={(e) => { setCustomValue(e.target.value); setCreateValue(''); }}
                      className="w-32"
                    />
                    <span className="text-sm text-muted-foreground">Kč</span>
                  </div>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Email příjemce <span className="text-muted-foreground">(volitelné)</span>
                </label>
                <Input
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  placeholder="prijemce@email.cz"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Platnost do <span className="text-muted-foreground">(volitelné)</span>
                </label>
                <Input
                  type="date"
                  value={createExpiry}
                  onChange={(e) => setCreateExpiry(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                />
              </div>
              {createError ? (
                <p className="text-sm text-destructive">{createError}</p>
              ) : null}
              <Button type="submit" disabled={creating}>
                {creating ? 'Vytvářím...' : 'Vytvořit'}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-2">
              {(['all', 'active', 'expired', 'used'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
                >
                  {f === 'all' ? 'Vše' : f === 'active' ? 'Aktivní' : f === 'expired' ? 'Expirované' : 'Vyčerpané'}
                </button>
              ))}
            </div>
            <form onSubmit={handleSearch} className="flex gap-2 ml-auto">
              <Input
                type="search"
                placeholder="Hledat kód nebo email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-48"
              />
              <Button type="submit" variant="outline" size="sm">
                Hledat
              </Button>
            </form>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Načítám…</p>
          ) : cards.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné gift karty.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-4">Kód</th>
                    <th className="py-2 pr-4">Hodnota</th>
                    <th className="py-2 pr-4">Zbývá</th>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Platnost</th>
                    <th className="py-2 pr-4">Stav</th>
                    <th className="py-2">Naposledy použita</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {cards.map((gc) => {
                    const isExpired =
                      gc.expires_at !== null && new Date(gc.expires_at).getTime() < Date.now();
                    const isDepleted = parseInt(gc.remaining_value_halire, 10) === 0;
                    const statusBadge =
                      !gc.is_active || isDepleted
                        ? <Badge variant="secondary">Vyčerpaná</Badge>
                        : isExpired
                        ? <Badge variant="destructive">Expirovaná</Badge>
                        : <Badge className="bg-emerald-100 text-emerald-800">Aktivní</Badge>;

                    return (
                      <tr key={gc.id} className="hover:bg-muted/30">
                        <td className="py-2 pr-4 font-mono font-semibold">{gc.code}</td>
                        <td className="py-2 pr-4">{priceLabel(gc.initial_value_halire, gc.currency)}</td>
                        <td className="py-2 pr-4">{priceLabel(gc.remaining_value_halire, gc.currency)}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{gc.issued_to_email ?? '—'}</td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {gc.expires_at
                            ? new Date(gc.expires_at).toLocaleDateString('cs-CZ')
                            : '—'}
                        </td>
                        <td className="py-2 pr-4">{statusBadge}</td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {gc.last_used_at
                            ? new Date(gc.last_used_at).toLocaleDateString('cs-CZ')
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
