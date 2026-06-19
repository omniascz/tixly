'use client';

import { FormEvent, useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface SeasonPassProduct {
  id: string;
  title: string;
  description: string | null;
  priceHalire: number;
  totalUses: number;
  validFrom: string | null;
  validUntil: string;
  maxPerBuyer: number | null;
  isActive: boolean;
  soldCount: number;
  createdAt: string;
}

interface SoldPass {
  id: string;
  productId: string;
  passToken: string;
  holderEmail: string;
  holderName: string | null;
  usesRemaining: number;
  totalUses: number;
  validUntil: string;
  status: string;
  productTitle: string;
  createdAt: string;
}

function formatPrice(halire: number): string {
  return (halire / 100).toLocaleString('cs-CZ') + ' Kč';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function toLocalDatetimeValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SeasonPassesAdminPage() {
  const [products, setProducts] = useState<SeasonPassProduct[]>([]);
  const [soldPasses, setSoldPasses] = useState<SoldPass[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingSold, setLoadingSold] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priceKc, setPriceKc] = useState('1500');
  const [totalUses, setTotalUses] = useState('10');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState(toLocalDatetimeValue(new Date(Date.now() + 365 * 86400_000).toISOString()));
  const [maxPerBuyer, setMaxPerBuyer] = useState('');
  const [isActive, setIsActive] = useState(true);

  async function loadProducts() {
    setLoadingProducts(true);
    try {
      const res = await fetch('/api/admin/season-pass-products');
      if (!res.ok) throw new Error('Chyba načítání');
      const data = await res.json() as { products: SeasonPassProduct[] };
      setProducts(data.products);
    } catch {
      setError('Nepodařilo se načíst produkty.');
    } finally {
      setLoadingProducts(false);
    }
  }

  async function loadSoldPasses() {
    setLoadingSold(true);
    try {
      const res = await fetch('/api/admin/season-passes/sold');
      if (!res.ok) throw new Error('Chyba načítání');
      const data = await res.json() as { passes: SoldPass[] };
      setSoldPasses(data.passes);
    } catch {
      setError('Nepodařilo se načíst prodané pasy.');
    } finally {
      setLoadingSold(false);
    }
  }

  useEffect(() => {
    void loadProducts();
    void loadSoldPasses();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const body = {
        title: title.trim(),
        description: description.trim() || undefined,
        priceHalire: Math.round(parseFloat(priceKc) * 100),
        totalUses: parseInt(totalUses, 10),
        validFrom: validFrom ? new Date(validFrom).toISOString() : undefined,
        validUntil: new Date(validUntil).toISOString(),
        maxPerBuyer: maxPerBuyer ? parseInt(maxPerBuyer, 10) : undefined,
        isActive,
      };
      const res = await fetch('/api/admin/season-pass-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        setError(j.error ?? 'Chyba při vytváření');
        return;
      }
      setSuccess('Sezónní pas vytvořen.');
      setShowForm(false);
      setTitle('');
      setDescription('');
      setPriceKc('1500');
      setTotalUses('10');
      setValidFrom('');
      setMaxPerBuyer('');
      await loadProducts();
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(product: SeasonPassProduct) {
    try {
      await fetch('/api/admin/season-pass-products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: product.id, isActive: !product.isActive }),
      });
      await loadProducts();
    } catch {
      setError('Nepodařilo se aktualizovat.');
    }
  }

  async function handleDelete(product: SeasonPassProduct) {
    if (!confirm(`Opravdu smazat "${product.title}"?`)) return;
    try {
      const res = await fetch('/api/admin/season-pass-products', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: product.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string; count?: number };
        if (j.error === 'HAS_SOLD_PASSES') {
          setError(`Nelze smazat — prodáno ${j.count ?? '?'} pasů.`);
          return;
        }
        setError(j.error ?? 'Chyba mazání');
        return;
      }
      setSuccess('Produkt smazán.');
      await loadProducts();
    } catch {
      setError('Chyba při mazání.');
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Sezónní pasy"
        description="Předplatné — zaplatíš jednou, přijdeš na N libovolných představení v sezóně."
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Zrušit' : '+ Nový pas'}
          </Button>
        }
      />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {success}
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nový sezónní pas</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleCreate(e)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm font-medium">Název</label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Sezónní karta 2026/27"
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm font-medium">Popis (volitelný)</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Vstup na libovolná představení sezóny…"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Cena (Kč)</label>
                  <Input
                    type="number"
                    value={priceKc}
                    onChange={(e) => setPriceKc(e.target.value)}
                    min={0}
                    step={1}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Počet vstupů</label>
                  <Input
                    type="number"
                    value={totalUses}
                    onChange={(e) => setTotalUses(e.target.value)}
                    min={1}
                    max={1000}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Platnost od (volitelná)</label>
                  <Input
                    type="datetime-local"
                    value={validFrom}
                    onChange={(e) => setValidFrom(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Platnost do</label>
                  <Input
                    type="datetime-local"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Max. na kupce (volitelné)</label>
                  <Input
                    type="number"
                    value={maxPerBuyer}
                    onChange={(e) => setMaxPerBuyer(e.target.value)}
                    min={1}
                    placeholder="Neomezeno"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="isActive"
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <label htmlFor="isActive" className="text-sm font-medium">
                    Ihned aktivní
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Zrušit
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? 'Ukládám…' : 'Vytvořit'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <section>
        <h2 className="mb-4 text-lg font-semibold">Produkty sezónních pasů</h2>
        {loadingProducts ? (
          <p className="text-sm text-muted-foreground">Načítám…</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žádné produkty. Vytvořte první sezónní pas.</p>
        ) : (
          <div className="space-y-3">
            {products.map((p) => (
              <Card key={p.id}>
                <CardContent className="pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{p.title}</span>
                        <Badge
                          className={
                            p.isActive
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }
                        >
                          {p.isActive ? 'Aktivní' : 'Neaktivní'}
                        </Badge>
                      </div>
                      {p.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">{p.description}</p>
                      )}
                      <div className="flex flex-wrap gap-4 text-sm">
                        <span>
                          <span className="text-muted-foreground">Cena: </span>
                          <span className="font-medium">{formatPrice(p.priceHalire)}</span>
                        </span>
                        <span>
                          <span className="text-muted-foreground">Vstupů: </span>
                          <span className="font-medium">{p.totalUses}</span>
                        </span>
                        <span>
                          <span className="text-muted-foreground">Platí do: </span>
                          <span className="font-medium">{formatDate(p.validUntil)}</span>
                        </span>
                        <span>
                          <span className="text-muted-foreground">Prodáno: </span>
                          <span className="font-medium">{p.soldCount}</span>
                        </span>
                        {p.maxPerBuyer && (
                          <span>
                            <span className="text-muted-foreground">Max/kupce: </span>
                            <span className="font-medium">{p.maxPerBuyer}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleToggleActive(p)}
                      >
                        {p.isActive ? 'Deaktivovat' : 'Aktivovat'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={() => void handleDelete(p)}
                        disabled={p.soldCount > 0}
                        title={p.soldCount > 0 ? `Nelze smazat — prodáno ${p.soldCount} pasů` : undefined}
                      >
                        Smazat
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">Prodané pasy</h2>
        {loadingSold ? (
          <p className="text-sm text-muted-foreground">Načítám…</p>
        ) : soldPasses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Zatím žádné prodané pasy.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-3 text-left font-medium">Držitel</th>
                  <th className="px-4 py-3 text-left font-medium">Pas</th>
                  <th className="px-4 py-3 text-left font-medium">Zbývá vstupů</th>
                  <th className="px-4 py-3 text-left font-medium">Platí do</th>
                  <th className="px-4 py-3 text-left font-medium">Token</th>
                </tr>
              </thead>
              <tbody>
                {soldPasses.map((sp) => (
                  <tr key={sp.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <div className="font-medium">{sp.holderName ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">{sp.holderEmail}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{sp.productTitle}</div>
                      <Badge
                        className={`mt-1 text-xs ${
                          sp.status === 'active'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {sp.status === 'active' ? 'Aktivní' : sp.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {sp.usesRemaining} / {sp.totalUses}
                    </td>
                    <td className="px-4 py-3">{formatDate(sp.validUntil)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {sp.passToken.slice(0, 8)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
