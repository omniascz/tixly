'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface SavedMethod {
  id: string;
  provider: string;
  card_mask: string | null;
  card_brand: string | null;
  expires_month: number | null;
  expires_year: number | null;
  is_default: boolean;
  created_at: string;
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

export default function MyPaymentMethodsPage() {
  const [methods, setMethods] = useState<SavedMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await authFetch('/api/buyer/saved-payment-methods');
      const d = await r.json() as { methods?: SavedMethod[] };
      setMethods(d.methods ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const remove = async (id: string) => {
    setBusy(id);
    await authFetch(`/api/buyer/saved-payment-methods/${id}`, { method: 'DELETE' });
    setBusy(null);
    await load();
  };

  const setDefault = async (id: string) => {
    setBusy(id);
    await authFetch(`/api/buyer/saved-payment-methods/${id}`, { method: 'PATCH' });
    setBusy(null);
    await load();
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Platební metody</h1>

      {loading ? (
        <p className="text-sm text-muted-foreground">Načítám…</p>
      ) : methods.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nemáte uložené žádné platební metody.
            <br />
            Karty se ukládají automaticky při platbě.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {methods.map((m) => (
            <Card key={m.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  💳 {m.card_brand ?? m.provider.toUpperCase()} {m.card_mask ?? ''}
                  {m.is_default && <Badge className="text-xs">Výchozí</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-3">
                {m.expires_month && m.expires_year ? (
                  <p className="text-xs text-muted-foreground mb-3">
                    Platí do: {String(m.expires_month).padStart(2, '0')}/{m.expires_year}
                  </p>
                ) : null}
                <div className="flex gap-2">
                  {!m.is_default && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === m.id}
                      onClick={() => setDefault(m.id)}
                    >
                      Nastavit jako výchozí
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy === m.id}
                    onClick={() => remove(m.id)}
                  >
                    Odstranit
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Platební metody jsou bezpečně uloženy a slouží pro rychlejší checkout při příštím nákupu.
      </p>
    </div>
  );
}
