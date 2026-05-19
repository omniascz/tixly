'use client';

import { FormEvent, useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface PromoCode {
  id: string;
  code: string;
  type: 'percentage' | 'fixed';
  discountValue: number;
  maxUses: number | null;
  usesCount: number;
  validFrom: string;
  validUntil: string | null;
  active: boolean;
  createdAt: string;
}

function fmtDiscount(c: PromoCode): string {
  if (c.type === 'percentage') return `${c.discountValue} %`;
  if (c.type === 'fixed') return `${(c.discountValue / 100).toFixed(0)} Kč`;
  return c.type;
}

export default function PromoCodesPage() {
  const [list, setList] = useState<PromoCode[]>([]);
  const [code, setCode] = useState('');
  const [type, setType] = useState<'percentage' | 'fixed'>('percentage');
  const [discount, setDiscount] = useState('10');
  const [maxUses, setMaxUses] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function reload() {
    const token = localStorage.getItem('accessToken');
    const r = await fetch('/api/admin/promo-codes', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (r.ok) {
      const data = (await r.json()) as { codes: PromoCode[] };
      setList(data.codes);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const r = await fetch('/api/admin/promo-codes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          code: code.toUpperCase(),
          type,
          discountValue:
            type === 'fixed'
              ? Math.round(parseFloat(discount) * 100)
              : parseInt(discount, 10),
          maxUses: maxUses ? parseInt(maxUses, 10) : null,
          validUntil: validUntil ? new Date(validUntil).toISOString() : null,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? `HTTP ${r.status}`);
        return;
      }
      setCode('');
      setMaxUses('');
      setValidUntil('');
      await reload();
    } catch {
      setError('Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Promo kódy"
        description="Sleva pro kupce — % nebo pevná částka. Aplikuje se v checkoutu."
      />

      <Card>
        <CardHeader>
          <CardTitle>Vytvořit nový kód</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium">Kód</label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="LETO2026"
                pattern="[A-Z0-9_-]{3,40}"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Typ</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={type}
                onChange={(e) => setType(e.target.value as 'percentage' | 'fixed')}
              >
                <option value="percentage">Procenta</option>
                <option value="fixed">Pevná částka (Kč)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                {type === 'percentage' ? 'Procenta (1–100)' : 'Sleva (Kč)'}
              </label>
              <Input
                type="number"
                min={1}
                max={type === 'percentage' ? 100 : undefined}
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Max použití (volit.)</label>
              <Input
                type="number"
                min={1}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="bez limitu"
              />
            </div>
            <div className="md:col-span-3">
              <label className="mb-1 block text-xs font-medium">Platí do (volit.)</label>
              <Input
                type="datetime-local"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>
            <div className="md:col-span-2 flex items-end">
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Ukládám…' : 'Vytvořit kód'}
              </Button>
            </div>
            {error && (
              <p className="md:col-span-5 text-sm text-destructive">{error}</p>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aktivní a historické kódy</CardTitle>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádné kódy.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Kód</th>
                  <th>Sleva</th>
                  <th>Použití</th>
                  <th>Platí do</th>
                  <th>Stav</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="border-b">
                    <td className="py-2 font-mono font-medium">{c.code}</td>
                    <td>{fmtDiscount(c)}</td>
                    <td>
                      {c.usesCount}
                      {c.maxUses ? ` / ${c.maxUses}` : ''}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {c.validUntil
                        ? new Date(c.validUntil).toLocaleString('cs-CZ')
                        : '—'}
                    </td>
                    <td>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${c.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}
                      >
                        {c.active ? 'aktivní' : 'neaktivní'}
                      </span>
                    </td>
                    <td className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          const token = localStorage.getItem('accessToken');
                          await fetch(`/api/admin/promo-codes/${c.id}`, {
                            method: 'PATCH',
                            headers: {
                              'Content-Type': 'application/json',
                              ...(token ? { Authorization: `Bearer ${token}` } : {}),
                            },
                            body: JSON.stringify({ active: !c.active }),
                          });
                          await reload();
                        }}
                      >
                        {c.active ? 'Deaktivovat' : 'Aktivovat'}
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
